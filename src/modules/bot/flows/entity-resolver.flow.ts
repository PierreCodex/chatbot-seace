import { Injectable, Logger } from '@nestjs/common';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import type { OutboundMessage } from '../../../ports/messaging.port';
import { EntitySearchService } from '../../search/entity-search.service';
import { EntityResultsPresenter } from '../presenters/entity.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { SearchAnunciosFlow } from './search-anuncios.flow';

const FLOW_ID = 'entity-resolver';
const MAX_ENTITY_CHOICES = 10;

type Step = 'awaiting-query' | 'disambiguation' | 'viewing';

interface FlowData {
  entityCandidates?: EntityLookupMatch[];
  entity?: EntityLookupMatch;
}

/**
 * Resolvedor de entidad standalone (UX-3, docs/06 §10.4). Accesible desde el menú
 * ("🔎 Consultar entidad"). Resuelve por nombre/sigla/RUC y ofrece acciones:
 *
 *   awaiting-query ──(texto)──▶ disambiguation* ──(elige)──▶ viewing
 *                                 └─(1 match) directo──────────▲
 *   viewing ──[Ver anuncios]──▶ search-anuncios (entidad fijada)
 *           └──[Crear alerta]──▶ (placeholder hasta UX-4)
 */
@Injectable()
export class EntityResolverFlow implements Flow {
  readonly id = FLOW_ID;
  private readonly logger = new Logger(EntityResolverFlow.name);

  constructor(
    private readonly entitySearch: EntitySearchService,
    private readonly presenter: EntityResultsPresenter,
    private readonly anunciosFlow: SearchAnunciosFlow,
  ) {}

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    switch (ctx.state.step as Step) {
      case 'awaiting-query':
        return this.onQuery(ctx);
      case 'disambiguation':
        return this.onPicked(ctx, data);
      case 'viewing':
        return this.onAction(ctx, data);
      default:
        return this.start(ctx);
    }
  }

  /** Entrada desde MainMenuFlow: pide el texto de la entidad. */
  start(ctx: FlowContext): FlowResult {
    return {
      messages: [
        textMsg(
          ctx,
          'Escribe el *nombre, sigla o RUC* de la entidad. Ej: _GORE Piura_, _Muni Sullana_, _20154265061_.',
        ),
      ],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-query',
      dataPatch: { entityCandidates: undefined, entity: undefined },
    };
  }

  private async onQuery(ctx: FlowContext): Promise<FlowResult> {
    const q = ctx.input.trim();
    if (q.length < 2) {
      return {
        messages: [textMsg(ctx, 'Necesito al menos 2 letras. Escribe el nombre, sigla o RUC.')],
      };
    }
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
        messages: [this.presenter.card(ctx, only)],
        nextStep: 'viewing',
        dataPatch: { entity: only, entityCandidates: [] },
      };
    }
    const top = matches.slice(0, MAX_ENTITY_CHOICES);
    return {
      messages: [this.presenter.disambiguation(ctx, matches.length, top)],
      nextStep: 'disambiguation',
      dataPatch: { entityCandidates: top },
    };
  }

  private onPicked(ctx: FlowContext, data: FlowData): FlowResult {
    const ruc = parseId(ctx.input, 'entity');
    const found = data.entityCandidates?.find((c) => c.ruc === ruc);
    if (!ruc || !found) {
      return {
        messages: [textMsg(ctx, 'No reconocí esa opción. Elige una de la lista anterior.')],
      };
    }
    return {
      messages: [this.presenter.card(ctx, found)],
      nextStep: 'viewing',
      dataPatch: { entity: found },
    };
  }

  private onAction(ctx: FlowContext, data: FlowData): FlowResult {
    const choice = parseId(ctx.input, 'entact');
    const entity = data.entity;
    if (!entity) {
      this.logger.warn('onAction sin entidad, reiniciando');
      return this.start(ctx);
    }
    if (choice === 'anuncios') {
      // Handoff al flujo ACF con la entidad ya fijada; falta elegir objeto.
      return this.anunciosFlow.startWithEntity(ctx, { ruc: entity.ruc, nombre: entity.nombre });
    }
    if (choice === 'alerta') {
      return {
        messages: [
          textMsg(
            ctx,
            'Las alertas por entidad llegan muy pronto 🔔. Por ahora puedo mostrarte sus anuncios futuros.',
          ),
          this.presenter.card(ctx, entity),
        ],
      };
    }
    return { messages: [this.presenter.card(ctx, entity)] };
  }
}

function textMsg(ctx: FlowContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

function parseId(input: string, prefix: string): string | null {
  if (!input.startsWith(`${prefix}:`)) return null;
  return input.slice(prefix.length + 1);
}
