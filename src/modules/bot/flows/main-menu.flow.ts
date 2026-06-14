import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';
import { MenuPresenter } from '../presenters/menu.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { EntityResolverFlow } from './entity-resolver.flow';
import { SearchAnunciosFlow } from './search-anuncios.flow';
import { SearchProcesosFlow } from './search-procesos.flow';
import { SubscribeFlow } from './subscribe.flow';

@Injectable()
export class MainMenuFlow implements Flow {
  id = 'main-menu';

  constructor(
    private readonly presenter: MenuPresenter,
    private readonly anunciosFlow: SearchAnunciosFlow,
    private readonly entityFlow: EntityResolverFlow,
    private readonly searchFlow: SearchProcesosFlow,
    private readonly subscribeFlow: SubscribeFlow,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const input = ctx.input.trim();

    // El usuario eligió una opción del menú o un botón de resultados.
    switch (input) {
      // ── Nivel 1 (Telegram): abrir el módulo ACF (submenú) ──
      case 'acf:module':
        // Reescribe el menú en su lugar → submenú ACF (sin alargar el chat).
        return {
          messages: [this.presenter.acfMenu(ctx.phoneNumberId, ctx.phoneNumber)],
          navigation: 'edit',
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
        };
      case 'soon':
        return this.replyAndShowMenu(
          ctx,
          '🔒 *Próximamente*\n\nLos demás módulos del SEACE (procedimientos, expresiones de interés y más) se integran pronto. Por ahora, los *Anuncios de Contratación Futura* ya están disponibles 👇',
        );

      // ── Anuncios de Contratación Futura (ACF) — core del MVP ──
      case 'anuncios':
      case 'acf:refine': {
        // Reescribe el mensaje origen (submenú) → selector de objeto, en el mismo
        // espacio (no deja botones colgados arriba).
        const r = await this.anunciosFlow.start(ctx);
        return { ...r, navigation: 'edit' };
      }
      case 'acf:subscribe':
        // "🔔 Avísame": crea una alerta heredando los filtros de la última búsqueda.
        return this.subscribeFlow.startCreate(ctx);

      // ── Mis alertas (gestión) ──
      case 'subscriptions':
        return this.subscribeFlow.startManage(ctx);
      case 'entity':
      case 'entidad': {
        const r = await this.entityFlow.start(ctx);
        return { ...r, navigation: 'edit' };
      }
      case 'help':
        return this.replyAndShowMenu(
          ctx,
          'Soy *DataSeace* 🤖. Te aviso de los Anuncios de Contratación Futura del Estado. Elige _Anuncios futuros_, escoge el objeto (obra, bien, etc.) y te muestro lo que viene.',
        );

      // ── Procedimientos (legacy F4, accesible por comando/botón) ──
      case 'search':
      case 'search:refine':
        return this.searchFlow.start(ctx);
      case 'search:subscribe':
        return this.replyAndShowMenu(
          ctx,
          'Pronto podrás suscribirte a esta búsqueda. Por ahora elige otra opción del menú.',
        );

      case 'menu:main':
      default: {
        // Cualquier otro input (incl. "hola", saludos, basura): mostrar el menú.
        // Primer contacto / `/start` → banner + menú. Volver al menú → desvanece el
        // mensaje actual (replace) y muestra el menú fresco.
        const messages = ctx.isNewConversation
          ? this.presenter.welcome(ctx.phoneNumberId, ctx.phoneNumber)
          : [this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber)];
        return {
          messages,
          navigation: 'replace',
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
        };
      }
    }
  }

  private replyAndShowMenu(ctx: FlowContext, text: string): FlowResult {
    const messages: OutboundMessage[] = [
      { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body: text },
      this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber),
    ];
    return { messages, nextFlowId: 'main-menu', nextStep: 'awaiting-selection' };
  }
}
