import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InboundMessage, MessagingPort, OutboundMessage } from '../../ports/messaging.port';
import { MESSAGING_PORT } from '../../ports/messaging.port';
import { ConversationStore } from './conversation.store';
import { FlowRegistry } from './flow.registry';
import type { ConversationState, FlowContext } from './types';
import { WaUsersService } from './wa-users.service';

const DEFAULT_FLOW = 'main-menu';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly store: ConversationStore,
    private readonly registry: FlowRegistry,
    private readonly waUsers: WaUsersService,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
  ) {}

  async processInbound(inbound: InboundMessage): Promise<void> {
    if (!inbound.phoneNumber || !inbound.phoneNumberId) {
      this.logger.warn('Inbound message without phone number, skipping');
      return;
    }

    // Upsert user
    const user = await this.waUsers.upsertByPhone(inbound.phoneNumber);

    // Load or create conversation state
    let state = await this.store.get(inbound.phoneNumber);
    if (!state) {
      state = this.createState(user.id, inbound);
    }

    // Determine input text
    let input = inbound.interactiveReplyId ?? inbound.text ?? '';

    // Comando de escape GLOBAL: desde cualquier flujo/paso, "menú", "inicio",
    // "salir", "cancelar", "/start"… reinician al menú principal. Da la "salida
    // siempre disponible" (docs/03 principio 4) y evita que el usuario quede
    // atrapado a media de un flujo. También el botón `menu:main` (lo emiten varias
    // fichas/presenters): debe llevar al menú sin importar en qué flujo esté.
    if (isResetCommand(input) || input === 'menu:main') {
      state = { ...state, flowId: DEFAULT_FLOW, step: 'awaiting-selection', data: {} };
      input = 'menu:main';
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

      // Send outbound messages
      for (const msg of result.messages) {
        await this.send(msg);
      }
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

  private async send(message: OutboundMessage): Promise<void> {
    try {
      const { messageId } = await this.messaging.send(message);
      this.logger.debug(`Sent ${message.kind} message ${messageId} to ${message.to}`);
    } catch (err) {
      this.logger.error(`Failed to send message: ${(err as Error).message}`);
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

function isResetCommand(input: string): boolean {
  const norm = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^\//, '')
    .trim();
  return RESET_COMMANDS.has(norm);
}
