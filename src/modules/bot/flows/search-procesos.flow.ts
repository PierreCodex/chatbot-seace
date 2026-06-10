import { Injectable, Logger } from '@nestjs/common';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import type { OutboundMessage } from '../../../ports/messaging.port';
import type { ObjetoContratacion, SearchFilters } from '../../../ports/persistence/types';
import { EntitySearchService } from '../../search/entity-search.service';
import { SearchResultsPresenter } from '../../search/presenters/search-results.presenter';
import { SearchFacade } from '../../search/search.facade';
import type { Flow, FlowContext, FlowResult } from '../types';

const FLOW_ID = 'search-procesos';
const MAX_ENTITY_CHOICES = 10;
const CURRENT_YEAR = new Date().getFullYear();

type Step =
  | 'awaiting-entity'
  | 'entity-disambiguation'
  | 'awaiting-anio'
  | 'awaiting-objeto'
  | 'confirm'
  | 'running';

interface FlowData {
  entityCandidates?: EntityLookupMatch[];
  selectedEntity?: { ruc: string; nombre: string };
  anio?: number | null;
  objeto?: ObjetoContratacion | null;
}

const OBJETO_LABELS: Record<ObjetoContratacion, string> = {
  bien: 'Bien',
  servicio: 'Servicio',
  obra: 'Obra',
  consultoria_obra: 'Consultoría de Obra',
};

/**
 * State machine de la búsqueda de procesos por WhatsApp.
 *
 *   awaiting-entity ──(texto)──▶ entity-disambiguation* ──▶ awaiting-anio
 *                                  └─(1 match) directo─────────▲
 *   awaiting-anio ──(lista)──▶ awaiting-objeto ──(lista)──▶ confirm
 *   confirm ──(buttons)──▶ running → cached_db/cache: entrega sync.
 *                         queued: mensaje "Buscando..." + reset; la entrega
 *                         del resultado la hace SearchResultsListener.
 */
@Injectable()
export class SearchProcesosFlow implements Flow {
  readonly id = FLOW_ID;
  private readonly logger = new Logger(SearchProcesosFlow.name);

  constructor(
    private readonly entitySearch: EntitySearchService,
    private readonly searchFacade: SearchFacade,
    private readonly resultsPresenter: SearchResultsPresenter,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    const step = ctx.state.step as Step;

    switch (step) {
      case 'awaiting-entity':
        return this.onEntityText(ctx, data);
      case 'entity-disambiguation':
        return this.onEntityPicked(ctx, data);
      case 'awaiting-anio':
        return this.onAnioPicked(ctx, data);
      case 'awaiting-objeto':
        return this.onObjetoPicked(ctx, data);
      case 'confirm':
        return this.onConfirmed(ctx, data);
      case 'running':
        return this.onRunning(ctx);
      default:
        return this.start(ctx);
    }
  }

  /** Entrada al flow desde MainMenuFlow. Pide el nombre de la entidad. */
  start(ctx: FlowContext): FlowResult {
    return {
      messages: [
        textMsg(
          ctx,
          '¿De qué entidad? Escribe el nombre (ej: _MINSA_, _piura_, _municipalidad de_).',
        ),
      ],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-entity',
      dataPatch: {
        entityCandidates: undefined,
        selectedEntity: undefined,
        anio: undefined,
        objeto: undefined,
      },
    };
  }

  private async onEntityText(ctx: FlowContext, _data: FlowData): Promise<FlowResult> {
    const q = ctx.input.trim();
    if (q.length < 2) {
      return {
        messages: [textMsg(ctx, 'Necesito al menos 2 letras. Escribe el nombre de la entidad.')],
      };
    }

    const matches = await this.entitySearch.search(q);
    if (matches.length === 0) {
      return {
        messages: [
          textMsg(
            ctx,
            'No encontré entidades con ese nombre. Prueba con otras palabras (ej: _ministerio_, _municipalidad_, ciudad o región).',
          ),
        ],
      };
    }

    if (matches.length === 1) {
      const only = matches[0];
      return {
        messages: [
          textMsg(ctx, `Entidad: *${only.nombre}*\nRUC ${only.ruc}`),
          this.anioListMessage(ctx),
        ],
        nextStep: 'awaiting-anio',
        dataPatch: { selectedEntity: { ruc: only.ruc, nombre: only.nombre }, entityCandidates: [] },
      };
    }

    const top = matches.slice(0, MAX_ENTITY_CHOICES);
    return {
      messages: [
        {
          kind: 'list',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          body: `Encontré ${matches.length} entidad${matches.length === 1 ? '' : 'es'}. Elige una:`,
          buttonText: 'Ver opciones',
          sections: [
            {
              title: 'Entidades',
              rows: top.map((m) => ({
                id: `entity:${m.ruc}`,
                title: truncate(m.nombre, 24),
                description: `RUC ${m.ruc}`,
              })),
            },
          ],
        },
      ],
      nextStep: 'entity-disambiguation',
      dataPatch: { entityCandidates: top },
    };
  }

  private onEntityPicked(ctx: FlowContext, data: FlowData): FlowResult {
    const ruc = parseId(ctx.input, 'entity');
    const found = data.entityCandidates?.find((c) => c.ruc === ruc);
    if (!ruc || !found) {
      return {
        messages: [textMsg(ctx, 'No reconocí esa opción. Selecciona una de la lista anterior.')],
      };
    }
    return {
      messages: [
        textMsg(ctx, `Entidad: *${found.nombre}*\nRUC ${found.ruc}`),
        this.anioListMessage(ctx),
      ],
      nextStep: 'awaiting-anio',
      dataPatch: { selectedEntity: { ruc: found.ruc, nombre: found.nombre } },
    };
  }

  private onAnioPicked(ctx: FlowContext, _data: FlowData): FlowResult {
    const raw = parseId(ctx.input, 'anio');
    if (!raw) {
      return {
        messages: [textMsg(ctx, 'Selecciona un año de la lista.'), this.anioListMessage(ctx)],
      };
    }
    const anio: number | null = raw === 'all' ? null : Number(raw);
    if (anio !== null && !Number.isFinite(anio)) {
      return {
        messages: [textMsg(ctx, 'Año inválido.'), this.anioListMessage(ctx)],
      };
    }
    return {
      messages: [this.objetoListMessage(ctx)],
      nextStep: 'awaiting-objeto',
      dataPatch: { anio },
    };
  }

  private onObjetoPicked(ctx: FlowContext, data: FlowData): FlowResult {
    const raw = parseId(ctx.input, 'objeto');
    if (!raw) {
      return {
        messages: [textMsg(ctx, 'Selecciona un objeto de la lista.'), this.objetoListMessage(ctx)],
      };
    }
    const objeto: ObjetoContratacion | null = raw === 'all' ? null : (raw as ObjetoContratacion);
    if (objeto !== null && !(objeto in OBJETO_LABELS)) {
      return {
        messages: [textMsg(ctx, 'Objeto inválido.'), this.objetoListMessage(ctx)],
      };
    }
    return {
      messages: [this.confirmMessage(ctx, { ...data, objeto })],
      nextStep: 'confirm',
      dataPatch: { objeto },
    };
  }

  private async onConfirmed(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const choice = parseId(ctx.input, 'confirm');
    if (choice === 'no') {
      return {
        messages: [textMsg(ctx, 'Búsqueda cancelada. Escribe _hola_ para volver al menú.')],
        nextFlowId: 'main-menu',
        nextStep: 'awaiting-selection',
        dataPatch: {
          entityCandidates: undefined,
          selectedEntity: undefined,
          anio: undefined,
          objeto: undefined,
        },
      };
    }
    if (choice !== 'yes') {
      return {
        messages: [this.confirmMessage(ctx, data)],
      };
    }

    const entity = data.selectedEntity;
    if (!entity) {
      this.logger.warn('onConfirmed sin selectedEntity, reseteando');
      return this.start(ctx);
    }

    const filters: SearchFilters = { entityRuc: entity.ruc };
    if (data.anio != null) filters.anioConvocatoria = data.anio;
    if (data.objeto != null) filters.objeto = data.objeto;

    const outcome = await this.searchFacade.search({
      userId: ctx.userId,
      phoneNumber: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      tab: 'procedimientos',
      filters,
    });

    if (outcome.source === 'cached_db' || outcome.source === 'cache') {
      const messages = this.resultsPresenter.build({
        phoneNumber: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        totalFound: outcome.totalFound,
        processes: outcome.processes,
        fromCache: true,
      });
      return {
        messages,
        nextFlowId: 'main-menu',
        nextStep: 'awaiting-selection',
        dataPatch: { entityCandidates: undefined, selectedEntity: undefined },
      };
    }

    // queued: el resultado lo entrega SearchResultsListener asincrónicamente.
    return {
      messages: [
        textMsg(
          ctx,
          'Buscando en SEACE… esto puede tardar 1-3 minutos la primera vez. Te aviso apenas tenga resultados ✅',
        ),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { entityCandidates: undefined, selectedEntity: undefined },
    };
  }

  private onRunning(ctx: FlowContext): FlowResult {
    return {
      messages: [
        textMsg(
          ctx,
          'Sigo buscando, te aviso apenas tenga los resultados. Gracias por la paciencia.',
        ),
      ],
    };
  }

  // ── builders de mensajes ──

  private anioListMessage(ctx: FlowContext): OutboundMessage {
    const years = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿De qué año es la convocatoria?',
      buttonText: 'Ver años',
      sections: [
        {
          title: 'Año',
          rows: [
            ...years.map((y) => ({ id: `anio:${y}`, title: String(y) })),
            { id: 'anio:all', title: 'Todos los años' },
          ],
        },
      ],
    };
  }

  private objetoListMessage(ctx: FlowContext): OutboundMessage {
    const rows = (Object.entries(OBJETO_LABELS) as [ObjetoContratacion, string][]).map(
      ([id, title]) => ({ id: `objeto:${id}`, title }),
    );
    rows.push({ id: 'objeto:all' as `objeto:${ObjetoContratacion}`, title: 'Todos' });
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿Qué objeto de contratación?',
      buttonText: 'Ver opciones',
      sections: [{ title: 'Objeto', rows }],
    };
  }

  private confirmMessage(ctx: FlowContext, data: FlowData): OutboundMessage {
    const entity = data.selectedEntity?.nombre ?? '(sin entidad)';
    const anio = data.anio != null ? String(data.anio) : 'Todos';
    const objeto = data.objeto != null ? OBJETO_LABELS[data.objeto] : 'Todos';
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Voy a buscar:\n*Entidad:* ${entity}\n*Año:* ${anio}\n*Objeto:* ${objeto}\n\n¿Procedemos?`,
      buttons: [
        { id: 'confirm:yes', title: 'Buscar' },
        { id: 'confirm:no', title: 'Cancelar' },
      ],
    };
  }
}

// ── helpers ──

function textMsg(ctx: FlowContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

function parseId(input: string, prefix: string): string | null {
  if (!input.startsWith(`${prefix}:`)) return null;
  return input.slice(prefix.length + 1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
