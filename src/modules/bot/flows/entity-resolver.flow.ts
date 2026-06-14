import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tgDivider, tgEmoji } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import { FILES_PORT, type FilesPort } from '../../../ports/files.port';
import type { OutboundMessage } from '../../../ports/messaging.port';
import { EntitySearchService } from '../../search/entity-search.service';
import { EntityResultsPresenter } from '../presenters/entity.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { entitiesOverflowMessages, friendlyError } from './search-anuncios.flow';

const FLOW_ID = 'entity-resolver';
const MAX_ENTITY_CHOICES = 10;

/** Ids de control "ajenos" a este flujo (botones viejos). Excluye `entity:` y
 * `entact:` porque son propios y los maneja cada paso explícitamente. */
const STALE_CONTROL = /^(acf|nudge|objeto|search|anuncios|subscriptions):/i;

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

  private readonly isTelegram: boolean;

  constructor(
    private readonly entitySearch: EntitySearchService,
    private readonly presenter: EntityResultsPresenter,
    @Inject(FILES_PORT) private readonly files: FilesPort,
    config: ConfigService<Env, true>,
  ) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  /** Varias coincidencias: Telegram muestra todos los RUC (sin elegir); WhatsApp
   * usa la lista interactiva de desambiguación (elegir una). */
  private multiMatch(ctx: FlowContext, total: number, top: EntityLookupMatch[]): FlowResult {
    if (this.isTelegram) {
      return {
        messages: [this.presenter.matchList(ctx, total, top)],
        nextStep: 'awaiting-query',
        dataPatch: { entityCandidates: [], entity: undefined },
      };
    }
    return {
      messages: [this.presenter.disambiguation(ctx, total, top)],
      nextStep: 'disambiguation',
      dataPatch: { entityCandidates: top },
    };
  }

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

  /** Botones de cierre tras un dead-end (0 resultados / lista en PDF): seguir
   * buscando o finalizar. `menu:main` lo intercepta ConversationService → menú. */
  private followup(ctx: FlowContext): OutboundMessage {
    // Telegram: guía de texto (sin botones que se apilen en el historial).
    if (this.isTelegram) {
      return textMsg(
        ctx,
        `${tgEmoji('write')} <i>Escribe otro nombre para buscar · /menu para volver</i>`,
        true,
      );
    }
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿Buscar otra entidad o volver al menú?',
      buttons: [
        { id: 'entact:otra', title: '🔎 Otra entidad' },
        { id: 'menu:main', title: '📋 Menú' },
      ],
    };
  }

  /** Entrada desde MainMenuFlow: pide el texto de la entidad. */
  start(ctx: FlowContext): FlowResult {
    return {
      messages: [this.askEntityMsg(ctx)],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-query',
      dataPatch: { entityCandidates: undefined, entity: undefined },
    };
  }

  /** Prompt para pedir la entidad (channel-aware). */
  private askEntityMsg(ctx: FlowContext): OutboundMessage {
    if (this.isTelegram) {
      return {
        kind: 'text',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body:
          `🏢 <b>Consultar entidad</b>\n` +
          `${tgDivider(8)}\n` +
          `Escribí el <b>nombre</b>, la <b>sigla</b> o el <b>RUC</b> de la entidad que querés consultar.\n\n` +
          `<i>Por ejemplo:</i>\n` +
          `${tgEmoji('search')} <code>GORE Piura</code>\n` +
          `${tgEmoji('search')} <code>Muni Sullana</code>\n` +
          `${tgEmoji('ruc')} <code>20154265061</code>`,
      };
    }
    return textMsg(
      ctx,
      'Escribe el *nombre, sigla o RUC* de la entidad. Ej: _GORE Piura_, _Muni Sullana_, _20154265061_.',
    );
  }

  private async onQuery(ctx: FlowContext): Promise<FlowResult> {
    const q = ctx.input.trim();
    // "🔎 Otra entidad" (desde los botones de cierre) → re-pedir el texto.
    if (q === 'entact:otra') return this.start(ctx);
    // Guard: tap a un botón viejo mientras esperábamos texto → re-pedir.
    if (STALE_CONTROL.test(q) || /^(entity|entact):/i.test(q)) {
      return { messages: [this.askEntityMsg(ctx)] };
    }
    if (q.length < 2) {
      return {
        messages: [textMsg(ctx, 'Necesito al menos 2 letras. Escribe el nombre, sigla o RUC.')],
      };
    }
    return this.runQuery(ctx, q);
  }

  /** Búsqueda + presentación por cantidad. Reutilizada desde cualquier paso para
   * que "escribir otra entidad" funcione siempre (flujo perdonador). */
  private async runQuery(ctx: FlowContext, q: string): Promise<FlowResult> {
    // "Consultando…" transitorio: se borra al entregar el resultado (deleteMessageIds).
    const status = await ctx.notify(this.consultandoMsg(ctx));
    const del = status.messageId ? [status.messageId] : undefined;

    let matches;
    try {
      matches = await this.entitySearch.search(q);
    } catch (err) {
      return {
        messages: [textMsg(ctx, friendlyError(err)), this.followup(ctx)],
        nextStep: 'awaiting-query',
        deleteMessageIds: del,
      };
    }
    if (matches.length === 0) {
      return {
        messages: [
          textMsg(
            ctx,
            'No encontré entidades con eso. Prueba con otras palabras (ciudad, región) o pega el RUC.',
          ),
          this.followup(ctx),
        ],
        nextStep: 'awaiting-query',
        dataPatch: { entityCandidates: [], entity: undefined },
        deleteMessageIds: del,
      };
    }
    if (matches.length === 1) {
      const only = matches[0];
      return {
        messages: [this.presenter.card(ctx, only)],
        nextStep: 'viewing',
        dataPatch: { entity: only, entityCandidates: [] },
        deleteMessageIds: del,
      };
    }
    // >10: PDF con todas + botones de cierre (degrada a top-10 sin PDF).
    if (matches.length > MAX_ENTITY_CHOICES) {
      const pdfUrl = await this.files.hostEntitiesPdf(matches);
      if (pdfUrl) {
        return {
          messages: [
            ...entitiesOverflowMessages(
              ctx,
              matches.length,
              pdfUrl,
              `📄 Son ${matches.length} entidades. En el PDF tienes todas con su *RUC*.`,
            ),
            this.followup(ctx),
          ],
          nextStep: 'awaiting-query',
          dataPatch: { entityCandidates: [], entity: undefined },
          deleteMessageIds: del,
        };
      }
      const top = matches.slice(0, MAX_ENTITY_CHOICES);
      return { ...this.multiMatch(ctx, matches.length, top), deleteMessageIds: del };
    }

    const top = matches.slice(0, MAX_ENTITY_CHOICES);
    return { ...this.multiMatch(ctx, matches.length, top), deleteMessageIds: del };
  }

  /** "Consultando…" (animation-ready en Telegram: html + tgEmoji, swappable). */
  private consultandoMsg(ctx: FlowContext): OutboundMessage {
    if (this.isTelegram) {
      return {
        kind: 'text',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body: `${tgEmoji('loading')} <i>Consultando en SEACE…</i>`,
      };
    }
    return textMsg(ctx, '🔎 Consultando en SEACE…');
  }

  private async onPicked(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const q = ctx.input.trim();
    const ruc = parseId(q, 'entity');
    if (ruc) {
      const found = data.entityCandidates?.find((c) => c.ruc === ruc);
      if (found) {
        return {
          messages: [this.presenter.card(ctx, found)],
          nextStep: 'viewing',
          dataPatch: { entity: found },
        };
      }
      return {
        messages: [textMsg(ctx, 'No reconocí esa opción. Elige una de la lista anterior.')],
      };
    }
    if (q === 'entact:otra') return this.start(ctx);
    if (STALE_CONTROL.test(q) || /^entact:/i.test(q)) {
      return { messages: [textMsg(ctx, 'Elige una de la lista o escríbeme otro nombre/RUC.')] };
    }
    // Texto libre en la desambiguación → nueva búsqueda (flujo perdonador).
    if (q.length < 2) {
      return { messages: [textMsg(ctx, 'Elige una de la lista o escríbeme otro nombre/RUC.')] };
    }
    return this.runQuery(ctx, q);
  }

  private async onAction(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const q = ctx.input.trim();
    // Resolvedor lookup-only: la ficha solo ofrece "Otra entidad" o "Menú"
    // (`menu:main` lo intercepta ConversationService). Para ver anuncios, el
    // usuario vuelve al menú y elige "Anuncios futuros".
    if (parseId(q, 'entact') === 'otra') return this.start(ctx);
    const entity = data.entity;
    // Botón de control ajeno → re-mostrar la ficha; texto libre → nueva búsqueda.
    if (STALE_CONTROL.test(q) || /^(entity|entact):/i.test(q)) {
      return entity ? { messages: [this.presenter.card(ctx, entity)] } : this.start(ctx);
    }
    if (q.length < 2) {
      return entity ? { messages: [this.presenter.card(ctx, entity)] } : this.start(ctx);
    }
    return this.runQuery(ctx, q);
  }
}

function textMsg(ctx: FlowContext, body: string, html = false): OutboundMessage {
  return {
    kind: 'text',
    to: ctx.phoneNumber,
    phoneNumberId: ctx.phoneNumberId,
    body,
    ...(html ? { html: true } : {}),
  };
}

function parseId(input: string, prefix: string): string | null {
  if (!input.startsWith(`${prefix}:`)) return null;
  return input.slice(prefix.length + 1);
}
