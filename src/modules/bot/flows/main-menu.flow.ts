import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';
import { MenuPresenter } from '../presenters/menu.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { EntityResolverFlow } from './entity-resolver.flow';
import { SearchAnunciosFlow } from './search-anuncios.flow';
import { SearchProcesosFlow } from './search-procesos.flow';

@Injectable()
export class MainMenuFlow implements Flow {
  id = 'main-menu';

  constructor(
    private readonly presenter: MenuPresenter,
    private readonly anunciosFlow: SearchAnunciosFlow,
    private readonly entityFlow: EntityResolverFlow,
    private readonly searchFlow: SearchProcesosFlow,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const input = ctx.input.trim();

    // El usuario eligió una opción del menú o un botón de resultados.
    switch (input) {
      // ── Anuncios de Contratación Futura (ACF) — core del MVP ──
      case 'anuncios':
      case 'acf:refine':
        return this.anunciosFlow.start(ctx);
      case 'acf:subscribe':
        return this.replyAndShowMenu(
          ctx,
          'Las alertas llegan muy pronto 🔔. Por ahora puedo mostrarte anuncios futuros cuando quieras.',
        );

      // ── Otras entradas del menú (pendientes de fase) ──
      case 'subscriptions':
        return this.replyAndShowMenu(
          ctx,
          'Tus alertas llegan en la próxima fase 🔔. Mientras tanto, revisa los anuncios futuros 👇',
        );
      case 'entity':
      case 'entidad':
        return this.entityFlow.start(ctx);
      case 'help':
        return this.replyAndShowMenu(
          ctx,
          'Soy ContrataBot 🤖. Te aviso de los Anuncios de Contratación Futura del Estado. Elige _Anuncios futuros_, escoge el objeto (obra, bien, etc.) y te muestro lo que viene.',
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
      default:
        // Cualquier otro input (incl. "hola", saludos, basura): mostrar el menú.
        return {
          messages: [this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber)],
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
        };
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
