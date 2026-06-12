import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';
import type { StoredProcess } from '../../../ports/persistence/processes.repo.port';

const MAX_CARDS = 5;

interface PresentContext {
  phoneNumber: string;
  phoneNumberId: string;
  totalFound: number;
  processes: StoredProcess[];
  /** Cuándo la búsqueda fue resuelta desde DB en lugar de scrape live. */
  fromCache?: boolean;
}

/**
 * Construye los `OutboundMessage`s que el bot manda al usuario tras una
 * búsqueda. Patrón: 1 mensaje cabecera + hasta 5 tarjetas (text cada una) +
 * 1 mensaje de acciones (botones Ver más / Refinar / Suscribirme).
 *
 * "Ver ficha" y "Suscribirme" son placeholders en F4 — los flows reales se
 * conectan en F5/F7.
 */
@Injectable()
export class SearchResultsPresenter {
  build(ctx: PresentContext): OutboundMessage[] {
    if (ctx.processes.length === 0) {
      return [
        {
          kind: 'text',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          body: 'No encontré procesos con esos filtros. Prueba con otro nombre de entidad o ampliando el año.',
        },
      ];
    }

    const top = ctx.processes.slice(0, MAX_CARDS);
    const header = buildHeader(ctx, top.length);
    const cards: OutboundMessage[] = top.map((p) => ({
      kind: 'text',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: formatCard(p),
    }));

    const footer: OutboundMessage = {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: '¿Qué hago ahora?',
      buttons: [
        { id: 'search:refine', title: 'Refinar' },
        { id: 'search:subscribe', title: 'Suscribirme' },
        { id: 'menu:main', title: 'Menú' },
      ],
    };

    return [
      {
        kind: 'text',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        body: header,
      },
      ...cards,
      footer,
    ];
  }
}

function buildHeader(ctx: PresentContext, shown: number): string {
  const cachedNote = ctx.fromCache ? ' _(desde cache)_' : '';
  if (ctx.totalFound === 0) {
    return `No encontré procesos.${cachedNote}`;
  }
  if (ctx.totalFound <= shown) {
    return `Encontré ${ctx.totalFound} proceso${ctx.totalFound === 1 ? '' : 's'}.${cachedNote}`;
  }
  return `Encontré ${ctx.totalFound} procesos. Te muestro los ${shown} más recientes:${cachedNote}`;
}

function formatCard(p: StoredProcess): string {
  // Campos propios de Procedimientos en p.procedimiento (CTI).
  const proc = p.procedimiento;
  const lines: string[] = [];
  const nom = proc?.nomenclatura ?? '(sin nomenclatura)';
  lines.push(`*${nom}*`);
  lines.push(p.entityNombre);
  if (p.descripcion) lines.push(truncate(p.descripcion, 160));
  const meta: string[] = [];
  if (p.objeto) meta.push(capitalize(p.objeto.replace('_', ' ')));
  if (proc?.valorReferencial != null) {
    const moneda = proc.moneda ?? 'S/';
    meta.push(`${moneda} ${formatMoney(proc.valorReferencial.toString())}`);
  }
  if (p.fechaPublicacion) meta.push(formatDate(p.fechaPublicacion));
  if (meta.length) lines.push(meta.join(' · '));
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMoney(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
