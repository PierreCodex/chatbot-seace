import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserChannel } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import type { InboundMessage, MessagingPort, OutboundMessage } from '../../ports/messaging.port';
import { MESSAGING_PORT } from '../../ports/messaging.port';
import { AdminCommandsService, type AdminHandleResult } from '../admin/admin-commands.service';
import { ConversationStore } from './conversation.store';
import { FlowRegistry } from './flow.registry';
import type { ConversationState, FlowContext, FlowResult } from './types';
import { WaUsersService } from './wa-users.service';

const DEFAULT_FLOW = 'main-menu';
const ENTITY_FLOW = 'entity-resolver';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  // Canal activo (MESSAGING_CHANNEL). Coincide con el enum UserChannel; se usa para
  // identificar al usuario por (canal, id-de-canal) — el `phoneNumber` del inbound
  // es el teléfono en WhatsApp o el chat_id en Telegram.
  private readonly channel: UserChannel;

  constructor(
    private readonly store: ConversationStore,
    private readonly registry: FlowRegistry,
    private readonly waUsers: WaUsersService,
    private readonly admin: AdminCommandsService,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    config: ConfigService<Env, true>,
  ) {
    this.channel = config.get('MESSAGING_CHANNEL', { infer: true });
  }

  async processInbound(inbound: InboundMessage): Promise<void> {
    if (!inbound.phoneNumber || !inbound.phoneNumberId) {
      this.logger.warn('Inbound message without phone number, skipping');
      return;
    }

    // Indicador "escribiendo…" mientras el bot trabaja (Telegram; fire-and-forget).
    this.messaging.sendChatAction?.(inbound.phoneNumber, 'typing').catch(() => {});

    // Upsert user por identidad de canal (teléfono en WA, chat_id en Telegram).
    const user = await this.waUsers.upsertByChannel(this.channel, inbound.phoneNumber);

    // Load or create conversation state
    let state = await this.store.get(inbound.phoneNumber);
    const isNewConversation = !state || inbound.isNewConversation;
    if (!state) {
      state = this.createState(user.id, inbound);
    }

    // Determine input text
    let input = inbound.interactiveReplyId ?? inbound.text ?? '';

    // Router de administración (roles/planes), ANTES del router de flujos: si el
    // input es un comando admin/`/miplan`, lo maneja aquí y corta. Devuelve `[]`
    // en modo sigilo (no-autorizado tipeando un comando admin → sin respuesta).
    // Ver docs/17.
    const adminResult = await this.admin.handle({
      senderId: inbound.phoneNumber,
      phoneNumberId: inbound.phoneNumberId,
      input,
      sourceMessageId: inbound.sourceMessageId,
    });
    if (adminResult !== null) {
      await this.deliverAdmin(adminResult, inbound);
      return;
    }

    // Comando de escape GLOBAL: desde cualquier flujo/paso, "menú", "inicio",
    // "salir", "cancelar", "/start"… reinician al menú principal. Da la "salida
    // siempre disponible" (docs/03 principio 4) y evita que el usuario quede
    // atrapado a media de un flujo. También el botón `menu:main` (lo emiten varias
    // fichas/presenters): debe llevar al menú sin importar en qué flujo esté.
    if (isResetCommand(input) || input === 'menu:main') {
      state = { ...state, flowId: DEFAULT_FLOW, step: 'awaiting-selection', data: {} };
      input = 'menu:main';
    }

    // Comando GLOBAL `/ent <texto>`: lookup de entidad desde cualquier punto. Con
    // argumento busca directo; sin argumento abre el flujo (pide el nombre).
    const entArg = parseEntityCommand(input);
    if (entArg !== null) {
      state = {
        ...state,
        flowId: ENTITY_FLOW,
        step: entArg ? 'awaiting-query' : 'initial',
        data: {},
      };
      input = entArg;
    }

    // Find current flow
    const flow = this.registry.get(state.flowId) ?? this.registry.get(DEFAULT_FLOW);
    if (!flow) {
      this.logger.error(`No flow found for id=${state.flowId}`);
      return;
    }

    const ctx: FlowContext = {
      userId: user.id,
      phoneNumber: inbound.phoneNumber,
      phoneNumberId: inbound.phoneNumberId,
      state,
      input,
      isNewConversation,
      notify: (message) => this.send(message),
    };

    try {
      const result = await flow.handle(ctx);

      // Update state
      const nextState: ConversationState = {
        ...state,
        flowId: result.nextFlowId ?? state.flowId,
        step: result.nextStep ?? state.step,
        data: result.dataPatch ? { ...state.data, ...result.dataPatch } : state.data,
        updatedAt: Date.now(),
      };

      if (result.endConversation) {
        await this.store.del(inbound.phoneNumber);
      } else {
        await this.store.set(nextState);
      }

      // Entrega los mensajes según la intención de navegación.
      await this.deliver(result, inbound);
    } catch (err) {
      this.logger.error(`Flow ${flow.id} failed: ${(err as Error).message}`);
      // Reset to main menu on error
      await this.store.del(inbound.phoneNumber);
      const fallback = this.registry.get(DEFAULT_FLOW);
      if (fallback) {
        const fallbackResult = await fallback.handle(ctx);
        for (const msg of fallbackResult.messages) {
          await this.send(msg);
        }
      }
    }
  }

  /**
   * Entrega el resultado del router admin respetando su `navigation` (paginación de
   * /cmds): `edit` reescribe el mensaje origen, `delete` lo borra (Cerrar).
   */
  private async deliverAdmin(result: AdminHandleResult, inbound: InboundMessage): Promise<void> {
    const srcId = inbound.sourceMessageId;
    if (result.navigation === 'delete' && this.messaging.deleteMessage && srcId) {
      await this.messaging.deleteMessage(inbound.phoneNumber, srcId).catch(() => {});
      return;
    }
    if (
      result.navigation === 'edit' &&
      this.messaging.editMessage &&
      srcId &&
      result.messages.length > 0
    ) {
      try {
        await this.messaging.editMessage(result.messages[0], srcId);
      } catch (err) {
        this.logger.debug(`editMessage (admin) falló, envío normal: ${(err as Error).message}`);
        await this.send(result.messages[0]);
      }
      for (const m of result.messages.slice(1)) await this.send(m);
      return;
    }
    for (const m of result.messages) await this.send(m);
  }

  /**
   * Entrega los mensajes del resultado respetando `navigation` (Telegram). Si el canal
   * no soporta edit/delete o no hay mensaje origen, degrada a envío normal.
   */
  private async deliver(result: FlowResult, inbound: InboundMessage): Promise<void> {
    const msgs = result.messages;
    const srcId = inbound.sourceMessageId;

    if (result.navigation === 'edit' && this.messaging.editMessage && srcId && msgs.length > 0) {
      try {
        await this.messaging.editMessage(msgs[0], srcId);
      } catch (err) {
        this.logger.debug(`editMessage falló, envío normal: ${(err as Error).message}`);
        await this.send(msgs[0]);
      }
      for (const m of msgs.slice(1)) await this.send(m);
    } else {
      if (result.navigation === 'replace' && this.messaging.deleteMessage && srcId) {
        await this.messaging.deleteMessage(inbound.phoneNumber, srcId).catch(() => {});
      }
      for (const m of msgs) await this.send(m);
    }

    // Borra mensajes transitorios (ej. "Consultando…") una vez entregado el resultado.
    if (result.deleteMessageIds?.length && this.messaging.deleteMessage) {
      for (const id of result.deleteMessageIds) {
        await this.messaging.deleteMessage(inbound.phoneNumber, id).catch(() => {});
      }
    }
  }

  private async send(message: OutboundMessage): Promise<{ messageId: string }> {
    try {
      const { messageId } = await this.messaging.send(message);
      this.logger.debug(`Sent ${message.kind} message ${messageId} to ${message.to}`);
      return { messageId };
    } catch (err) {
      this.logger.error(`Failed to send message: ${(err as Error).message}`);
      return { messageId: '' };
    }
  }

  private createState(userId: string, inbound: InboundMessage): ConversationState {
    return {
      userId,
      phoneNumber: inbound.phoneNumber,
      phoneNumberId: inbound.phoneNumberId,
      flowId: DEFAULT_FLOW,
      step: 'initial',
      data: {},
      updatedAt: Date.now(),
    };
  }
}

/** Palabras que reinician al menú desde cualquier flujo (normalizadas: sin
 * tildes, sin "/" inicial, minúsculas). Cubre los términos intuitivos típicos. */
const RESET_COMMANDS = new Set(['menu', 'inicio', 'salir', 'cancelar', 'start', 'volver']);

/** Detecta `/ent`, `/ent piura`, `/ent@DataSeaceBot 20154265061`. Devuelve el
 * argumento (puede ser ''), o null si no es el comando. */
function parseEntityCommand(input: string): string | null {
  const m = /^\/ent(?:@\w+)?(?:\s+(.*))?$/i.exec(input.trim());
  return m ? (m[1] ?? '').trim() : null;
}

function isResetCommand(input: string): boolean {
  const norm = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^\//, '')
    .trim();
  return RESET_COMMANDS.has(norm);
}
