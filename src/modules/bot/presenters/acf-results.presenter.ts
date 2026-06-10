import { Injectable } from '@nestjs/common';
import type { Process as StoredProcess } from '@prisma/client';
import type { OutboundMessage } from '../../../ports/messaging.port';

const MAX_CARDS = 5;

export interface AcfPresentContext {
  phoneNumber: string;
  phoneNumberId: string;
  totalFound: number;
  processes: StoredProcess[];
}

/**
 * Presentación de resultados de Anuncios de Contratación Futura (ver
 * docs/06-whatsapp-ux.md §10.5/§10.6).
 *
 *  - ≤5 resultados → tarjetas en el chat (descripción truncada). Sin ficha/bases.
 *  - >5 resultados → resumen + las 5 más recientes. El PDF "ficha-por-anuncio"
 *    (UX-5 completo) requiere el kind `document` en MessagingPort, pendiente.
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
      ];
    }

    const top = ctx.processes.slice(0, MAX_CARDS);
    const header =
      ctx.totalFound <= MAX_CARDS
        ? `Encontré ${ctx.totalFound} anuncio${ctx.totalFound === 1 ? '' : 's'} de contratación futura:`
        : `Encontré ${ctx.totalFound} anuncios futuros. Te muestro los ${top.length} más recientes ` +
          '(pronto: PDF con todos):';

    const cards: OutboundMessage[] = top.map((p) => text(ctx, formatAcfCard(p)));

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

    return [text(ctx, header), ...cards, footer];
  }
}

function text(ctx: AcfPresentContext, body: string): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body };
}

function formatAcfCard(p: StoredProcess): string {
  const lines: string[] = [`*${p.entityNombre}*`];

  const pub: string[] = [];
  if (p.fechaPublicacion) pub.push(`📅 Publicado ${formatDate(p.fechaPublicacion)}`);
  if (p.objeto) pub.push(capitalize(p.objeto.replace('_', ' ')));
  if (pub.length) lines.push(pub.join(' · '));

  const conv: string[] = [];
  if (p.fechaAproxConv) conv.push(`🗓️ Conv. aprox. ${formatDate(p.fechaAproxConv)}`);
  if (p.plazoDias != null) conv.push(`⏱️ ${p.plazoDias} días`);
  if (conv.length) lines.push(conv.join(' · '));

  if (p.tipoSeleccion) lines.push(`_${p.tipoSeleccion}_`);
  if (p.descripcion) lines.push(`"${truncate(p.descripcion, 180)}"`);

  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
