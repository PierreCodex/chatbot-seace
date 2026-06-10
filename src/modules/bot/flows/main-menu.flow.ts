import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';
import { MenuPresenter } from '../presenters/menu.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { SearchProcesosFlow } from './search-procesos.flow';

@Injectable()
export class MainMenuFlow implements Flow {
  id = 'main-menu';

  constructor(
    private readonly presenter: MenuPresenter,
    private readonly searchFlow: SearchProcesosFlow,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const input = ctx.input.trim();

    // El usuario eligió una opción del menú.
    switch (input) {
      case 'search':
        return this.searchFlow.start(ctx);
      case 'subscriptions':
        return this.replyAndShowMenu(
          ctx,
          'Las suscripciones llegan en la próxima fase. Mientras tanto, puedes buscar procesos 👇',
        );
      case 'help':
        return this.replyAndShowMenu(
          ctx,
          'Soy ContrataBot 🤖. Te ayudo a buscar procesos del SEACE. Elige _Buscar procesos_ para empezar.',
        );
      // Buttons que vienen de la pantalla de resultados de búsqueda.
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
