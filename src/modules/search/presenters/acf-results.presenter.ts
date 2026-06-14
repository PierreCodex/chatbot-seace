import { Injectable } from '@nestjs/common';
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
 * Presentación de resultados de Anuncios de Contratación Futura (ver
 * docs/06-whatsapp-ux.md §10.5/§10.6).
 *
 *  - ≤5 resultados → tarjetas en el chat (descripción truncada). Sin ficha/bases.
 *  - >5 resultados → resumen + las 5 más recientes. Si backend provee `pdfUrl`,
 *    se adjunta además un documento PDF con todos (kind `document`).
 */
@Injectable()
export class AcfResultsPresenter {
  build(ctx: AcfPresentContext): OutboundMessage[] {
    if (ctx.processes.length === 0) {
      return [
        text(
          ctx,
          'No hay anuncios futuros con esos filtros. Prueba con otro objeto o sin acotar por entidad.',
        ),
        {
          kind: 'buttons',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          body: '¿Qué hago ahora?',
          buttons: [
            { id: 'acf:refine', title: '✏️ Nueva búsqueda' },
            { id: 'menu:main', title: '🏁 Menú' },
          ],
        },
      ];
    }

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

    const footer: OutboundMessage = {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿Qué hago ahora?',
      buttons: [
        { id: 'acf:subscribe', title: '🔔 Suscribirme' },
        { id: 'acf:refine', title: '✏️ Refinar' },
        { id: 'menu:main', title: 'Menú' },
      ],
    };

    return [text(ctx, header), ...cards, ...pdf, footer];
  }
}

function text(ctx: AcfPresentContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

function formatAcfCard(p: StoredProcess): string {
  // Campos compartidos en la base; los propios de ACF en p.acf (CTI).
  const acf = p.acf;
  const lines: string[] = [`*${p.entityNombre}*`];

  // Encabezado: objeto · tipo de selección.
  const head: string[] = [];
  if (p.objeto) head.push(`🏗️ ${capitalize(p.objeto.replace('_', ' '))}`);
  if (acf?.tipoSeleccion) head.push(`_${acf.tipoSeleccion}_`);
  if (head.length) lines.push(head.join(' · '));

  // Bloque: descripción + CUI (extraído del alcance).
  const desc: string[] = [];
  if (p.descripcion) desc.push(`📋 ${truncate(p.descripcion, 200)}`);
  const cui = extractCui(acf?.alcance);
  if (cui) desc.push(`🔖 CUI ${cui}`);
  if (desc.length) lines.push('', ...desc);

  // Bloque: fechas + plazo. fechaPublicacion = instante (hora Perú);
  // fechaAproxConv = DATE (Prisma lo da como medianoche UTC) → formatear en UTC
  // para no correr el día hacia atrás en zonas al oeste (Lima = UTC-5).
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
