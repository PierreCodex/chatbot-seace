import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import { FILES_PORT, type FilesPort } from '../../../ports/files.port';
import type { OutboundMessage } from '../../../ports/messaging.port';
import type { ObjetoContratacion, SearchFilters } from '../../../ports/persistence/types';
import { EntitySearchService } from '../../search/entity-search.service';
import { SearchFacade } from '../../search/search.facade';
import { AcfResultsPresenter } from '../../search/presenters/acf-results.presenter';
import { entityTitle } from '../presenters/entity.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';

const FLOW_ID = 'search-anuncios';
const MAX_ENTITY_CHOICES = 10;

type Step = 'awaiting-objeto' | 'menu' | 'soft-nudge' | 'awaiting-entity' | 'entity-disambiguation';

interface FlowData {
  objeto?: ObjetoContratacion;
  entity?: { ruc: string; nombre: string };
  entityCandidates?: EntityLookupMatch[];
}

const OBJETO_LABELS: Record<ObjetoContratacion, string> = {
  obra: 'Obra',
  bien: 'Bien',
  servicio: 'Servicio',
  consultoria_obra: 'Consultoría de Obra',
};

/**
 * Búsqueda de Anuncios de Contratación Futura (ACF) — variante A + empujón suave.
 * Spec: docs/06-whatsapp-ux.md §10.
 *
 *   awaiting-objeto ──(objeto obligatorio)──▶ menu
 *   menu ──[Buscar ahora]── sin entidad ──▶ soft-nudge ──[Buscar todos]──▶ search
 *        └──[Buscar ahora]── con entidad ─────────────────────────────────▶ search
 *        └──[Filtrar entidad]──▶ awaiting-entity ──▶ (disambiguation) ──▶ menu
 *   soft-nudge ──[Filtrar entidad]──▶ awaiting-entity
 */
@Injectable()
export class SearchAnunciosFlow implements Flow {
  readonly id = FLOW_ID;
  private readonly logger = new Logger(SearchAnunciosFlow.name);

  constructor(
    private readonly entitySearch: EntitySearchService,
    private readonly searchFacade: SearchFacade,
    private readonly resultsPresenter: AcfResultsPresenter,
    @Inject(FILES_PORT) private readonly files: FilesPort,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    switch (ctx.state.step as Step) {
      case 'awaiting-objeto':
        return this.onObjeto(ctx, data);
      case 'menu':
        return this.onMenu(ctx, data);
      case 'soft-nudge':
        return this.onNudge(ctx, data);
      case 'awaiting-entity':
        return this.onEntityText(ctx, data);
      case 'entity-disambiguation':
        return this.onEntityPicked(ctx, data);
      default:
        return this.start(ctx);
    }
  }

  /** Entrada desde MainMenuFlow: pide el objeto (obligatorio). */
  start(ctx: FlowContext): FlowResult {
    return {
      messages: [this.objetoListMessage(ctx)],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-objeto',
      dataPatch: { objeto: undefined, entity: undefined, entityCandidates: undefined },
    };
  }

  /**
   * Entrada desde el resolvedor de entidad standalone (UX-3): la entidad ya está
   * elegida; solo falta el objeto (obligatorio). Tras elegirlo, el menú dinámico
   * ya muestra la entidad fijada.
   */
  startWithEntity(ctx: FlowContext, entity: { ruc: string; nombre: string }): FlowResult {
    return {
      messages: [this.objetoListMessage(ctx)],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-objeto',
      dataPatch: { objeto: undefined, entity, entityCandidates: undefined },
    };
  }

  private onObjeto(ctx: FlowContext, data: FlowData): FlowResult {
    const raw = parseId(ctx.input, 'objeto');
    if (!raw || !(raw in OBJETO_LABELS)) {
      return {
        messages: [
          textMsg(ctx, 'El objeto es obligatorio. Elige uno de la lista.'),
          this.objetoListMessage(ctx),
        ],
      };
    }
    const objeto = raw as ObjetoContratacion;
    return {
      messages: [this.menuMessage(ctx, { ...data, objeto })],
      nextStep: 'menu',
      dataPatch: { objeto },
    };
  }

  private async onMenu(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const choice = parseId(ctx.input, 'acf');
    if (choice === 'buscar') {
      // Empujón suave: si no hay filtro de alcance (entidad), confirmar.
      if (!data.entity) {
        return { messages: [this.nudgeMessage(ctx, data)], nextStep: 'soft-nudge' };
      }
      return this.runSearch(ctx, data);
    }
    if (choice === 'entidad') {
      return { messages: [this.askEntityMessage(ctx)], nextStep: 'awaiting-entity' };
    }
    if (choice === 'quitar') {
      return {
        messages: [this.menuMessage(ctx, { ...data, entity: undefined })],
        nextStep: 'menu',
        dataPatch: { entity: undefined },
      };
    }
    return { messages: [this.menuMessage(ctx, data)] };
  }

  private async onNudge(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const choice = parseId(ctx.input, 'nudge');
    if (choice === 'entidad') {
      return { messages: [this.askEntityMessage(ctx)], nextStep: 'awaiting-entity' };
    }
    if (choice === 'all') {
      return this.runSearch(ctx, data); // A2: objeto-only
    }
    return { messages: [this.nudgeMessage(ctx, data)] };
  }

  private async onEntityText(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const q = ctx.input.trim();
    // Guard: el usuario tocó un botón viejo (ej. "nudge:all") mientras
    // esperábamos texto → no buscarlo como entidad, re-pedir.
    if (isControlId(q)) {
      return { messages: [this.askEntityMessage(ctx)] };
    }
    if (q.length < 2) {
      return {
        messages: [textMsg(ctx, 'Necesito al menos 2 letras. Escribe el nombre, sigla o RUC.')],
      };
    }
    await ctx.notify(textMsg(ctx, '🔎 Consultando en SEACE… dame un segundito ⏳'));
    const matches = await this.entitySearch.search(q);
    if (matches.length === 0) {
      return {
        messages: [
          textMsg(
            ctx,
            'No encontré entidades con eso. Prueba con otras palabras (ciudad, región) o pega el RUC.',
          ),
        ],
      };
    }
    if (matches.length === 1) {
      const only = matches[0];
      return {
        messages: [
          this.menuMessage(ctx, { ...data, entity: { ruc: only.ruc, nombre: only.nombre } }),
        ],
        nextStep: 'menu',
        dataPatch: { entity: { ruc: only.ruc, nombre: only.nombre }, entityCandidates: [] },
      };
    }
    // >10 coincidencias: no caben en la lista nativa → PDF con todas + pedir
    // RUC/nombre exacto. Si no hay PUBLIC_BASE_URL, degrada a lista top-10 + nota.
    if (matches.length > MAX_ENTITY_CHOICES) {
      const pdfUrl = await this.files.hostEntitiesPdf(matches);
      if (pdfUrl) {
        return {
          messages: entitiesOverflowMessages(ctx, matches.length, pdfUrl),
          nextStep: 'awaiting-entity',
          dataPatch: { entityCandidates: [] },
        };
      }
      const top = matches.slice(0, MAX_ENTITY_CHOICES);
      return {
        messages: [
          textMsg(
            ctx,
            `Encontré ${matches.length}. Te muestro 10; afina con ciudad/región o escríbeme el RUC exacto.`,
          ),
          this.entityListMessage(ctx, matches.length, top),
        ],
        nextStep: 'entity-disambiguation',
        dataPatch: { entityCandidates: top },
      };
    }

    const top = matches.slice(0, MAX_ENTITY_CHOICES);
    return {
      messages: [this.entityListMessage(ctx, matches.length, top)],
      nextStep: 'entity-disambiguation',
      dataPatch: { entityCandidates: top },
    };
  }

  private onEntityPicked(ctx: FlowContext, data: FlowData): FlowResult {
    const ruc = parseId(ctx.input, 'entity');
    const found = data.entityCandidates?.find((c) => c.ruc === ruc);
    if (!ruc || !found) {
      return {
        messages: [textMsg(ctx, 'No reconocí esa opción. Elige una de la lista anterior.')],
      };
    }
    return {
      messages: [
        this.menuMessage(ctx, { ...data, entity: { ruc: found.ruc, nombre: found.nombre } }),
      ],
      nextStep: 'menu',
      dataPatch: { entity: { ruc: found.ruc, nombre: found.nombre } },
    };
  }

  private async runSearch(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    if (!data.objeto) {
      this.logger.warn('runSearch sin objeto, reseteando');
      return this.start(ctx);
    }
    const filters: SearchFilters = { objeto: data.objeto };
    // ACF: filtrar por nombre (los anuncios no cargan RUC). El nombre viene de
    // la tabla `entities`, así coincide con el nombre raspado del anuncio.
    if (data.entity) filters.entityNombre = data.entity.nombre;

    const outcome = await this.searchFacade.search({
      userId: ctx.userId,
      phoneNumber: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      tab: 'anuncios_futuros',
      filters,
    });

    const reset = { objeto: undefined, entity: undefined, entityCandidates: undefined };

    if (outcome.source === 'cached_db' || outcome.source === 'cache') {
      // >5 → adjuntar PDF con todos (si el backend puede hospedarlo).
      const pdfUrl =
        outcome.totalFound > 5
          ? ((await this.files.hostAcfPdf(outcome.processes)) ?? undefined)
          : undefined;
      const messages = this.resultsPresenter.build({
        phoneNumber: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        totalFound: outcome.totalFound,
        processes: outcome.processes,
        pdfUrl,
      });
      return {
        messages,
        nextFlowId: 'main-menu',
        nextStep: 'awaiting-selection',
        dataPatch: reset,
      };
    }

    // queued: la entrega del resultado la hace SearchResultsListener.
    return {
      messages: [
        textMsg(ctx, 'Buscando anuncios futuros… te aviso apenas tenga los resultados ✅'),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: reset,
    };
  }

  // ── builders ──

  private objetoListMessage(ctx: FlowContext): OutboundMessage {
    const rows = (Object.entries(OBJETO_LABELS) as [ObjetoContratacion, string][]).map(
      ([id, title]) => ({ id: `objeto:${id}`, title }),
    );
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: 'Anuncios de Contratación Futura. Para empezar elige el *objeto* (obligatorio):',
      buttonText: 'Elegir objeto',
      sections: [{ title: 'Objeto de contratación', rows }],
    };
  }

  private menuMessage(ctx: FlowContext, data: FlowData): OutboundMessage {
    const objeto = data.objeto ? OBJETO_LABELS[data.objeto] : '—';
    const alcance = data.entity ? data.entity.nombre : 'Todas las entidades';
    const rows: { id: string; title: string; description?: string }[] = [
      { id: 'acf:buscar', title: '🔍 Buscar ahora' },
      {
        id: 'acf:entidad',
        title: data.entity ? '🏢 Cambiar entidad' : '🏢 Filtrar por entidad',
      },
    ];
    if (data.entity) {
      rows.push({ id: 'acf:quitar', title: '🌎 Quitar entidad' });
    }
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `✅ Filtros: *${objeto}* · ${alcance}\n¿Buscar así o quieres afinar?`,
      buttonText: 'Opciones',
      sections: [{ title: 'Búsqueda', rows }],
    };
  }

  private nudgeMessage(ctx: FlowContext, data: FlowData): OutboundMessage {
    const objeto = data.objeto ? OBJETO_LABELS[data.objeto] : 'ese objeto';
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Vas a ver TODOS los anuncios futuros de *${objeto}* (suelen ser varios). ¿Buscar así o acotar por entidad?`,
      buttons: [
        { id: 'nudge:all', title: '🌎 Buscar todos' },
        { id: 'nudge:entidad', title: '🏢 Filtrar entidad' },
      ],
    };
  }

  private askEntityMessage(ctx: FlowContext): OutboundMessage {
    return textMsg(
      ctx,
      'Escribe el nombre, sigla o RUC de la entidad. Ej: _GORE Piura_, _Muni Sullana_, _20154265061_.',
    );
  }

  private entityListMessage(
    ctx: FlowContext,
    total: number,
    top: EntityLookupMatch[],
  ): OutboundMessage {
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Encontré ${total} entidad${total === 1 ? '' : 'es'}. Elige una:`,
      buttonText: 'Ver entidades',
      sections: [
        {
          title: 'Entidades',
          rows: top.map((m) => ({
            id: `entity:${m.ruc}`,
            title: entityTitle(m.nombre),
            description: truncate(`${m.nombre} · RUC ${m.ruc}`, 72),
          })),
        },
      ],
    };
  }
}

// ── helpers ──

function textMsg(ctx: FlowContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

/** Mensajes para >10 coincidencias: documento PDF + pedido de RUC/nombre exacto. */
export function entitiesOverflowMessages(
  ctx: { phoneNumber: string; phoneNumberId: string },
  total: number,
  pdfUrl: string,
): OutboundMessage[] {
  return [
    {
      kind: 'document',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      link: pdfUrl,
      filename: 'entidades.pdf',
      caption: `${total} entidades coincidentes`,
    },
    {
      kind: 'text',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Son ${total} entidades. Abre el PDF y escríbeme el *RUC* o el *nombre exacto* de la que buscas.`,
    },
  ];
}

function parseId(input: string, prefix: string): string | null {
  if (!input.startsWith(`${prefix}:`)) return null;
  return input.slice(prefix.length + 1);
}

/** ¿El input es un id de botón/lista (ej. "nudge:all", "acf:buscar")? Sirve para
 * detectar taps a botones viejos cuando esperábamos texto libre. */
function isControlId(input: string): boolean {
  return /^(acf|nudge|objeto|entity|entact|menu|search|anuncios|entidad|subscriptions):/i.test(
    input,
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
