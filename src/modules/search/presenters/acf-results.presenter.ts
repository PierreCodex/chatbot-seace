import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TG_EFFECT, TG_EMOJI, tgAnuncios, tgEmoji } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { ButtonOption, OutboundMessage } from '../../../ports/messaging.port';
import type { StoredProcess } from '../../../ports/persistence/processes.repo.port';

const MAX_CARDS = 5;
// Separador de guiones (en vez del divisor animado ➿) para los resultados ACF.
const DASH = '- - - - - - - - - - - - - - - - - - - - -';

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
    // Cabecera: separador de guiones · "🆘 N ANUNCIOS" (letras animadas) ·
    // separador · descripción. Sin blockquote (el fondo confundía).
    const title = `${tgEmoji('anunciosHdr')}  <b>${ctx.totalFound}</b>  ${tgAnuncios()}`;
    const desc =
      ctx.totalFound <= MAX_CARDS
        ? ''
        : hasPdf
          ? `Te muestro los 5 más recientes y te adjunto el <b>PDF</b> con todos ${tgEmoji('elige')}`
          : `Te muestro los ${top.length} más recientes:`;
    const headerBody = desc
      ? `${DASH}\n${title}\n${DASH}\n${desc}\n${DASH}`
      : `${DASH}\n${title}\n${DASH}`;

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
      body: `${DASH}\n${cardTelegram(p)}`,
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

  /** Mensaje decorativo (se envía una vez, arriba de la lista): 🆘 ANUNCIOS. */
  resultsHeader(args: { to: string; phoneNumberId: string }): OutboundMessage {
    return {
      kind: 'text',
      to: args.to,
      phoneNumberId: args.phoneNumberId,
      html: true,
      effectId: TG_EFFECT.celebrate,
      body: `${tgEmoji('anunciosHdr')}  ${tgAnuncios()}`,
    };
  }

  /**
   * Una página de resultados (Telegram): un anuncio + navegación ◀/▶ + acciones.
   * In-place (el handler reescribe el mismo mensaje). `total` = total de anuncios
   * encontrados; `pages` = cuántos navegables hay.
   */
  pageMessage(args: {
    to: string;
    phoneNumberId: string;
    process: StoredProcess;
    index: number;
    pages: number;
    total: number;
    pdfUrl?: string;
  }): OutboundMessage {
    const { to, phoneNumberId, process, index, pages, total, pdfUrl } = args;
    const found =
      total === 1
        ? 'Se encontró <code>1</code> resultado'
        : `Se encontraron <code>${total}</code> resultados`;
    const body = `<blockquote>${found}   ·   <code>${index + 1}/${pages}</code></blockquote>\n${cardTelegram(process)}`;

    const nav: ButtonOption[] = [];
    if (index > 0) {
      nav.push({
        id: `acfpage:${index - 1}`,
        title: 'Anterior',
        style: 'primary',
        iconCustomEmojiId: TG_EMOJI.back.id,
      });
    }
    if (index < pages - 1) {
      nav.push({
        id: `acfpage:${index + 1}`,
        title: 'Siguiente',
        style: 'primary',
        iconCustomEmojiId: TG_EMOJI.navNext.id,
      });
    }
    const actions: ButtonOption[] = [
      {
        id: 'acf:subscribe',
        title: 'Avísame',
        style: 'success',
        iconCustomEmojiId: TG_EMOJI.avisameBtn.id,
      },
    ];
    if (pdfUrl) {
      actions.push({
        id: 'acf:pdf',
        title: 'PDF con todos',
        url: pdfUrl,
        iconCustomEmojiId: TG_EMOJI.pdfBtn.id,
      });
    }

    const buttons: ButtonOption[] = [
      ...nav,
      ...actions,
      // `menu:show` (no `menu:main`): muestra el menú en un mensaje nuevo, sin borrar
      // la tarjeta de resultados (queda en el historial).
      { id: 'menu:show', title: 'Menú', style: 'success', iconCustomEmojiId: TG_EMOJI.back.id },
    ];
    const layout = [...(nav.length ? [nav.length] : []), actions.length, 1];
    return {
      kind: 'buttons',
      to,
      phoneNumberId,
      html: true,
      body,
      buttons,
      buttonLayout: layout,
    };
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

/** Tarjeta Telegram: separador de guiones + objeto·tipo + campos (labels en
 * MAYÚSCULA), sin blockquote (sin barra/fondo de color). */
function cardTelegram(p: StoredProcess): string {
  const acf = p.acf;
  const head: string[] = [];
  if (p.objeto) head.push(`🏗️ <b>${esc(p.objeto.replace('_', ' ').toUpperCase())}</b>`);
  if (acf?.tipoSeleccion) head.push(`<i>${esc(acf.tipoSeleccion)}</i>`);

  const fields: string[] = [`🏛️ <b>ENTIDAD:</b> <code>${esc(p.entityNombre)}</code>`];
  if (p.descripcion) {
    fields.push(`📋 <b>OBJETO:</b> <code>${esc(truncate(p.descripcion, 220))}</code>`);
  }
  const cui = extractCui(acf?.alcance);
  if (cui) fields.push(`🔖 <b>CUI:</b> <code>${esc(cui)}</code>`);
  if (p.fechaPublicacion) {
    fields.push(`📅 <b>PUBLICADO:</b> <code>${formatDate(p.fechaPublicacion)}</code>`);
  }
  if (acf?.fechaAproxConv) {
    fields.push(`🗓️ <b>CONVOCATORIA:</b> <code>~${formatDate(acf.fechaAproxConv, 'UTC')}</code>`);
  }
  if (acf?.plazoDias != null) fields.push(`⏱️ <b>PLAZO:</b> <code>${acf.plazoDias} días</code>`);
  if (acf?.cantidad != null) {
    fields.push(`🔢 <b>CANTIDAD:</b> <code>${esc(String(acf.cantidad))}</code>`);
  }

  // Bullet animado antes de cada campo + interlineado (línea en blanco entre campos).
  const bulleted = fields.map((f) => `${tgEmoji('dot')} ${f}`);
  return `${head.join(' · ')}\n\n${bulleted.join('\n\n')}`;
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
