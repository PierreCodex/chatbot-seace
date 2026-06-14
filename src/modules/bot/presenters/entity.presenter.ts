import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tgDivider, tgEmoji } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import type { OutboundMessage } from '../../../ports/messaging.port';

const MAX_CHOICES = 10;

export interface EntityPresentContext {
  phoneNumber: string;
  phoneNumberId: string;
}

/**
 * Presentación del resolvedor de entidad (UX-3, docs/06 §10.4). Channel-aware:
 *  - **Telegram**: ficha y lista con HTML (RUC en monospace, punto animado,
 *    separador). En varias coincidencias **muestra todos los RUC directo** (el valor
 *    que el usuario busca) — sin botones por entidad.
 *  - **WhatsApp**: ficha + lista interactiva (rows para elegir) como antes.
 */
@Injectable()
export class EntityResultsPresenter {
  private readonly isTelegram: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  /** Ficha de una entidad ya resuelta + acciones. */
  card(ctx: EntityPresentContext, entity: EntityLookupMatch): OutboundMessage {
    return this.isTelegram ? this.cardTelegram(ctx, entity) : this.cardWhatsapp(ctx, entity);
  }

  /** Telegram: lista con TODOS los RUC visibles. Sin botones (no se apilan en el
   * historial) — se sigue tipeando otro nombre o `/menu` para volver. */
  matchList(
    ctx: EntityPresentContext,
    total: number,
    matches: EntityLookupMatch[],
  ): OutboundMessage {
    const top = matches.slice(0, MAX_CHOICES);
    const lines: string[] = [
      `${tgEmoji('search')} <b>${total} entidad${total === 1 ? '' : 'es'} encontrada${total === 1 ? '' : 's'}</b>`,
      tgDivider(7),
      '',
    ];
    for (const m of top) {
      lines.push(`${tgEmoji('dot')} <b>${esc(m.nombre)}</b>`);
      lines.push(`${tgEmoji('ruc')} <code>${esc(m.ruc)}</code>`);
      lines.push('');
    }
    if (total > top.length)
      lines.push(`<i>…y ${total - top.length} más. Afina con ciudad/región.</i>`, '');
    lines.push(TG_HINT);
    return tgText(ctx, lines.join('\n').trimEnd());
  }

  private cardTelegram(ctx: EntityPresentContext, entity: EntityLookupMatch): OutboundMessage {
    const lines = [
      `🏛️ <b>${esc(entity.nombre)}</b>`,
      tgDivider(7),
      `${tgEmoji('ruc')} <b>RUC:</b> <code>${esc(entity.ruc)}</code>`,
    ];
    if (entity.tipoDoc && entity.tipoDoc.toUpperCase() !== 'RUC') {
      lines.push(`<i>${esc(entity.tipoDoc)}</i>`);
    }
    lines.push(
      '',
      '<i>Para ver sus anuncios futuros, vuelve al menú → 📅 Anuncios futuros.</i>',
      '',
      TG_HINT,
    );
    return tgText(ctx, lines.join('\n'));
  }

  private cardWhatsapp(ctx: EntityPresentContext, entity: EntityLookupMatch): OutboundMessage {
    const lines = [`🏢 *${entity.nombre}*`, `RUC ${entity.ruc}`];
    if (entity.tipoDoc && entity.tipoDoc.toUpperCase() !== 'RUC') lines.push(`_${entity.tipoDoc}_`);
    lines.push('', '_Para ver sus anuncios futuros, vuelve al menú → 📅 Anuncios futuros._');
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: lines.join('\n'),
      buttons: [
        { id: 'entact:otra', title: '🔎 Otra entidad' },
        { id: 'menu:main', title: '📋 Menú' },
      ],
    };
  }

  /** WhatsApp: lista de desambiguación (rows para elegir). */
  disambiguation(
    ctx: EntityPresentContext,
    total: number,
    matches: EntityLookupMatch[],
  ): OutboundMessage {
    const top = matches.slice(0, MAX_CHOICES);
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

/** Línea guía al pie de los resultados (Telegram): sin botones que se apilen. */
const TG_HINT = `${tgEmoji('write')} <i>Escribe otro nombre para buscar · /menu para volver</i>`;

function tgText(ctx: EntityPresentContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, html: true, body };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Prefijos comunes de entidades públicas → abreviatura, para que la parte
 * distintiva (distrito/región) quepa en los 24 chars del título de WhatsApp. */
const PREFIX_ABBR: [RegExp, string][] = [
  [/^GOBIERNO REGIONAL (DE |DEL )?/i, 'GORE '],
  [/^MUNICIPALIDAD PROVINCIAL (DE |DEL )?/i, 'Muni. Prov. '],
  [/^MUNICIPALIDAD DISTRITAL (DE |DEL )?/i, 'Muni. Dist. '],
  [/^MUNICIPALIDAD METROPOLITANA (DE |DEL )?/i, 'Muni. Metrop. '],
  [/^MUNICIPALIDAD (DEL )?CENTRO POBLADO (MENOR )?(DE |DEL )?/i, 'Muni. C.P. '],
  [/^UNIVERSIDAD NACIONAL (DE |DEL )?/i, 'Univ. Nac. '],
  [/^INSTITUTO NACIONAL (DE |DEL )?/i, 'Inst. Nac. '],
  [/^DIRECCION REGIONAL (DE |DEL )?/i, 'Dir. Reg. '],
  [/^UNIDAD DE GESTION EDUCATIVA LOCAL (DE |DEL )?/i, 'UGEL '],
  [/^PROYECTO ESPECIAL /i, 'P.E. '],
];

/** Título de fila para una entidad: abrevia prefijo común y recorta a 24. */
export function entityTitle(nombre: string): string {
  let s = nombre.trim();
  for (const [re, abbr] of PREFIX_ABBR) {
    if (re.test(s)) {
      s = s.replace(re, abbr);
      break;
    }
  }
  return truncate(s, 24);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
