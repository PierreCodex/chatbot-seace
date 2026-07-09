import { Inject, Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
} from '../../../ports/persistence/processes.repo.port';
import { AcfResultsPresenter } from '../../search/presenters/acf-results.presenter';
import { MenuPresenter } from '../presenters/menu.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { EntityResolverFlow } from './entity-resolver.flow';
// AcfResultsState: estado de la lista paginada (incluye el hub de rubros NLU).
import { isFreeTextQuery, NluRouterFlow, type AcfResultsState } from './nlu-router.flow';
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
    private readonly nluFlow: NluRouterFlow,
    private readonly acfPresenter: AcfResultsPresenter,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const input = ctx.input.trim();

    // Navegación de la lista paginada de resultados ACF (◀/▶).
    if (input.startsWith('acfpage:')) return this.onAcfPage(ctx, input);
    // Hub de rubros del NLU (rubro:N / rubro:all / rubro:back): drill-down
    // in-place sobre el resultado ya clasificado. Delegado al flow NLU.
    if (input.startsWith('rubro:')) return this.nluFlow.onRubroAction(ctx);

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

      // "Menú" desde la tarjeta de resultados: muestra el menú en un mensaje NUEVO
      // (no borra la tarjeta, a diferencia de `menu:main` que hace replace).
      case 'menu:show':
        return {
          messages: [this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber)],
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
        };

      // ── Mis alertas (gestión) ──
      case 'subscriptions':
        return this.subscribeFlow.startManage(ctx);
      case 'entity':
      case 'entidad': {
        const r = await this.entityFlow.start(ctx);
        return { ...r, navigation: 'edit' };
      }
      case 'help':
        return {
          messages: [
            {
              kind: 'text',
              to: ctx.phoneNumber,
              phoneNumberId: ctx.phoneNumberId,
              body:
                'Soy *DataSeace* 🤖. Te aviso de los *Anuncios de Contratación Futura* del Estado peruano.\n\n' +
                'Escribime lo que buscás o tocá *Menú* para ver las opciones guiadas.',
            },
            this.presenter.helpButton(ctx.phoneNumberId, ctx.phoneNumber),
          ],
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
        };

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
        // Texto libre "huérfano" → NLU (docs/21 §3.1): consulta en lenguaje
        // natural desde el menú/idle. Solo aquí — los wizards activos reciben
        // su texto por state.flowId, así que el NLU nunca les roba input. Si
        // el NLU está apagado, sin key o falla, cae al menú (fallback invisible).
        if (input !== 'menu:main' && !ctx.isNewConversation && isFreeTextQuery(input)) {
          if (this.nluFlow.enabled) {
            const r = await this.nluFlow.handleFreeText(ctx);
            if (r) return r;
          }
        }
        // Cualquier otro input (incl. botones viejos, basura): mostrar el menú.
        // Primer contacto / `/start` → banner + menú. Volver al menú → desvanece el
        // mensaje actual (replace) y muestra el menú fresco.
        const messages = ctx.isNewConversation
          ? this.presenter.welcome(ctx.phoneNumberId, ctx.phoneNumber, ctx.displayName)
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

  /** Renderiza la página N de los resultados ACF (in-place). */
  private async onAcfPage(ctx: FlowContext, input: string): Promise<FlowResult> {
    const res = ctx.state.data?.acfResults as AcfResultsState | undefined;
    if (!res?.ids?.length) {
      // Sin estado (sesión vieja): no rompemos, mostramos el menú.
      return { messages: [this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber)] };
    }
    const idx = Math.max(
      0,
      Math.min(Number(input.slice('acfpage:'.length)) || 0, res.ids.length - 1),
    );
    const process = await this.processes.findById(res.ids[idx]);
    if (!process) {
      return { messages: [this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber)] };
    }
    return {
      messages: [
        this.acfPresenter.pageMessage({
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          process,
          index: idx,
          pages: res.ids.length,
          total: res.total,
          // PDF de la vista activa (rubro → PDF del rubro); el wizard clásico
          // no setea activePdfUrl y usa el general como siempre.
          pdfUrl: (res.activePdfUrl !== undefined ? res.activePdfUrl : res.pdfUrl) ?? undefined,
          // Hub de rubros activo: conservar la etiqueta del filtro y el botón
          // "🔙 Rubros" mientras se pagina dentro de la vista.
          filterLabel: res.activeLabel ?? undefined,
          backToRubros: Boolean(res.rubros?.length),
        }),
      ],
      navigation: 'edit',
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
    };
  }

  private replyAndShowMenu(ctx: FlowContext, text: string): FlowResult {
    const messages: OutboundMessage[] = [
      { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body: text },
      this.presenter.build(ctx.phoneNumberId, ctx.phoneNumber),
    ];
    return { messages, nextFlowId: 'main-menu', nextStep: 'awaiting-selection' };
  }
}
