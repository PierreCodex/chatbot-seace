import { Injectable } from '@nestjs/common';
import { tgDivider, tgEmoji } from '../../common/telegram-emoji';
import type { OutboundMessage } from '../../ports/messaging.port';
import type { StoredProcess } from '../../ports/persistence/processes.repo.port';
import type { StoredSubscription } from '../../ports/persistence/subscriptions.repo.port';

const OBJETO_LABELS: Record<string, string> = {
  obra: 'Obra',
  bien: 'Bien',
  servicio: 'Servicio',
  consultoria_obra: 'Consultoría de Obra',
};

const MAX_CARDS = 5;

/** Arma el mensaje de aviso de alerta (Telegram HTML): cabecera + tarjetas de los
 * anuncios nuevos + botón a "Mis alertas". */
@Injectable()
export class AlertPresenter {
  build(to: string, sub: StoredSubscription, procs: StoredProcess[]): OutboundMessage {
    const objeto = sub.objeto ? OBJETO_LABELS[sub.objeto] : 'anuncios';
    const alcance = sub.entityNombre ? esc(sub.entityNombre) : 'todas las entidades';
    // F2: el aviso dice a qué TEMA corresponde ("coincide con tu alerta de X").
    const tema = sub.keyword ? ` · 🎯 <i>${esc(sub.keyword)}</i>` : '';
    const n = procs.length;
    const cards = procs
      .slice(0, MAX_CARDS)
      .map((p) => this.card(p))
      .join('\n');
    const extra = n > MAX_CARDS ? `\n<i>…y ${n - MAX_CARDS} más.</i>` : '';
    const body =
      `${tgEmoji('alert')} <b>Nuevo${n === 1 ? '' : 's'} anuncio${n === 1 ? '' : 's'} para tu alerta</b>\n` +
      `📦 <b>${esc(objeto)}</b> · 🏛️ ${alcance}${tema}\n` +
      tgDivider(8) +
      '\n' +
      cards +
      extra;
    return {
      kind: 'buttons',
      to,
      phoneNumberId: '',
      html: true,
      body,
      buttons: [{ id: 'subscriptions', title: '🔔 Mis alertas', style: 'primary' }],
    };
  }

  private card(p: StoredProcess): string {
    const lines = [`🏛️ <b>${esc(p.entityNombre ?? '—')}</b>`];
    if (p.descripcion) lines.push(`📝 ${esc(truncate(p.descripcion, 110))}`);
    if (p.fechaPublicacion) lines.push(`🗓️ Publicado: <code>${fmtDate(p.fechaPublicacion)}</code>`);
    return `<blockquote>${lines.join('\n')}</blockquote>`;
  }
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(d);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
