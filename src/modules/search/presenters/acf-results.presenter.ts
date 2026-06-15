import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TG_EFFECT,
  TG_EMOJI,
  tgAnuncios,
  tgDivider,
  tgEmoji,
} from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { OutboundMessage } from '../../../ports/messaging.port';
import type { StoredProcess } from '../../../ports/persistence/processes.repo.port';

const MAX_CARDS = 5;

export interface AcfPresentContext {
  phoneNumber: string;
  phoneNumberId: string;
  totalFound: number;
  processes: StoredProcess[];
  /**
   * URL del PDF ya hospedado con TODOS los anuncios (lo genera modules/files en
   * backend). Si está presente y hay >5 resultados, se adjunta como documento.
   * Si falta, se degrada a las 5 tarjetas + nota.
   */
  pdfUrl?: string;
}

/**
 * Presentación de resultados de Anuncios de Contratación Futura. Channel-aware:
 *  - **Telegram**: tarjetas con HTML (`<blockquote expandable>` colapsable, monospace,
 *    separador animado) + efecto al entregar. Más "panel de datos".
 *  - **WhatsApp**: tarjetas de texto plano (markdown) como antes.
 *
 * Reglas (docs/06 §10.5/§10.6): ≤5 → tarjetas; >5 → 5 + PDF con todos (kind document).
 */
@Injectable()
export class AcfResultsPresenter {
  private readonly isTelegram: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  build(ctx: AcfPresentContext): OutboundMessage[] {
    if (ctx.processes.length === 0) return this.empty(ctx);
    return this.isTelegram ? this.telegram(ctx) : this.whatsapp(ctx);
  }

  private empty(ctx: AcfPresentContext): OutboundMessage[] {
    return [
      text(
        ctx,
        'No hay anuncios futuros con esos filtros. Prueba con otro objeto o sin acotar por entidad.',
      ),
      {
        kind: 'buttons',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        body: '¿Qué quieres hacer?',
        buttons: [
          { id: 'acf:refine', title: '✏️ Nueva búsqueda' },
          { id: 'menu:main', title: '🏁 Menú' },
        ],
      },
    ];
  }

  // ── Telegram ──
  private telegram(ctx: AcfPresentContext): OutboundMessage[] {
    const top = ctx.processes.slice(0, MAX_CARDS);
    const hasPdf = ctx.totalFound > MAX_CARDS && !!ctx.pdfUrl;
    // Cabecera con la palabra ANUNCIOS en emojis-letra animados.
    const countLine = `${tgEmoji('anunciosHdr')} <b>${ctx.totalFound}</b> ${tgAnuncios()} <b>futuros</b>`;
    const headerBody =
      ctx.totalFound <= MAX_CARDS
        ? countLine
        : hasPdf
          ? `${countLine}\nTe muestro los ${top.length} más recientes y te adjunto el <b>PDF</b> con todos 👇`
          : `${countLine}\nTe muestro los ${top.length} más recientes:`;

    const header: OutboundMessage = {
      kind: 'text',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: true,
      effectId: TG_EFFECT.celebrate,
      body: headerBody,
    };

    const cards: OutboundMessage[] = top.map((p) => ({
      kind: 'text',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: true,
      body: cardTelegram(p),
    }));

    const pdf: OutboundMessage[] = hasPdf
      ? [
          {
            kind: 'document',
            to: ctx.phoneNumber,
            phoneNumberId: ctx.phoneNumberId,
            link: ctx.pdfUrl as string,
            filename: 'anuncios-futuros.pdf',
            caption: `${ctx.totalFound} anuncios de contratación futura`,
          },
        ]
      : [];

    return [header, ...cards, ...pdf, this.footer(ctx)];
  }

  // ── WhatsApp ──
  private whatsapp(ctx: AcfPresentContext): OutboundMessage[] {
    const top = ctx.processes.slice(0, MAX_CARDS);
    const hasPdf = ctx.totalFound > MAX_CARDS && !!ctx.pdfUrl;
    const header =
      ctx.totalFound <= MAX_CARDS
        ? `Encontré ${ctx.totalFound} anuncio${ctx.totalFound === 1 ? '' : 's'} de contratación futura:`
        : hasPdf
          ? `Encontré ${ctx.totalFound} anuncios futuros. Te muestro los ${top.length} más recientes ` +
            'y te adjunto el PDF con todos 👇'
          : `Encontré ${ctx.totalFound} anuncios futuros. Te muestro los ${top.length} más recientes ` +
            '(pronto: PDF con todos):';

    const cards: OutboundMessage[] = top.map((p) => text(ctx, formatAcfCard(p)));
    const pdf: OutboundMessage[] = hasPdf
      ? [
          {
            kind: 'document',
            to: ctx.phoneNumber,
            phoneNumberId: ctx.phoneNumberId,
            link: ctx.pdfUrl as string,
            filename: 'anuncios-futuros.pdf',
            caption: `${ctx.totalFound} anuncios de contratación futura`,
          },
        ]
      : [];

    return [text(ctx, header), ...cards, ...pdf, this.footer(ctx)];
  }

  private footer(ctx: AcfPresentContext): OutboundMessage {
    if (this.isTelegram) {
      return {
        kind: 'buttons',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body: '¿Te interesa alguno?',
        buttons: [
          { id: 'acf:subscribe', title: '🔔 Avísame', style: 'primary' },
          { id: 'acf:refine', title: '✏️ Refinar' },
          { id: 'menu:main', title: 'Menú', style: 'success', iconCustomEmojiId: TG_EMOJI.back.id },
        ],
        buttonLayout: [1, 2],
      };
    }
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿Te interesa alguno?',
      buttons: [
        { id: 'acf:subscribe', title: '🔔 Avísame' },
        { id: 'acf:refine', title: '✏️ Refinar' },
        { id: 'menu:main', title: 'Menú' },
      ],
    };
  }
}

function text(ctx: AcfPresentContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

/** Tarjeta Telegram: separador + objeto·tipo + blockquote expandable con campos. */
function cardTelegram(p: StoredProcess): string {
  const acf = p.acf;
  const head: string[] = [];
  if (p.objeto) head.push(`🏗️ <b>${esc(capitalize(p.objeto.replace('_', ' ')))}</b>`);
  if (acf?.tipoSeleccion) head.push(`<i>${esc(acf.tipoSeleccion)}</i>`);

  const fields: string[] = [`🏛️ <b>Entidad:</b> ${esc(p.entityNombre)}`];
  if (p.descripcion) fields.push(`📋 <b>Objeto:</b> ${esc(truncate(p.descripcion, 220))}`);
  const cui = extractCui(acf?.alcance);
  if (cui) fields.push(`🔖 <b>CUI:</b> <code>${esc(cui)}</code>`);
  if (p.fechaPublicacion) {
    fields.push(`📅 <b>Publicado:</b> <code>${formatDate(p.fechaPublicacion)}</code>`);
  }
  if (acf?.fechaAproxConv) {
    fields.push(`🗓️ <b>Convocatoria:</b> <code>~${formatDate(acf.fechaAproxConv, 'UTC')}</code>`);
  }
  if (acf?.plazoDias != null) fields.push(`⏱️ <b>Plazo:</b> <code>${acf.plazoDias} días</code>`);
  if (acf?.cantidad != null) {
    fields.push(`🔢 <b>Cantidad:</b> <code>${esc(String(acf.cantidad))}</code>`);
  }

  return `${tgDivider(8)}\n${head.join(' · ')}\n<blockquote expandable>${fields.join('\n')}</blockquote>`;
}

function formatAcfCard(p: StoredProcess): string {
  const acf = p.acf;
  const lines: string[] = [`*${p.entityNombre}*`];

  const head: string[] = [];
  if (p.objeto) head.push(`🏗️ ${capitalize(p.objeto.replace('_', ' '))}`);
  if (acf?.tipoSeleccion) head.push(`_${acf.tipoSeleccion}_`);
  if (head.length) lines.push(head.join(' · '));

  const desc: string[] = [];
  if (p.descripcion) desc.push(`📋 ${truncate(p.descripcion, 200)}`);
  const cui = extractCui(acf?.alcance);
  if (cui) desc.push(`🔖 CUI ${cui}`);
  if (desc.length) lines.push('', ...desc);

  const meta: string[] = [];
  if (p.fechaPublicacion) meta.push(`📅 Publicado:  ${formatDate(p.fechaPublicacion)}`);
  if (acf?.fechaAproxConv) meta.push(`🗓️ Convocatoria:  ~${formatDate(acf.fechaAproxConv, 'UTC')}`);
  if (acf?.plazoDias != null) meta.push(`⏱️ Plazo:  ${acf.plazoDias} días`);
  if (meta.length) lines.push('', ...meta);

  return lines.join('\n');
}

/** Extrae el código CUI del texto de alcance (ej. "… CON CUI: 2525669"). */
function extractCui(alcance: string | null | undefined): string | null {
  if (!alcance) return null;
  return /\bCUI[:\s]*(\d{3,})/i.exec(alcance)?.[1] ?? null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(d: Date, timeZone = 'America/Lima'): string {
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  });
}
