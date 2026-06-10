import { Injectable } from '@nestjs/common';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import type { OutboundMessage } from '../../../ports/messaging.port';

const MAX_CHOICES = 10;

export interface EntityPresentContext {
  phoneNumber: string;
  phoneNumberId: string;
}

/**
 * Presentación del resolvedor de entidad standalone (UX-3, docs/06 §10.4).
 *  - `card`: ficha de una entidad + acciones (Ver anuncios / Crear alerta).
 *  - `disambiguation`: lista de coincidencias cuando hay varias.
 */
@Injectable()
export class EntityResultsPresenter {
  /** Ficha de una entidad ya resuelta con sus acciones. */
  card(ctx: EntityPresentContext, entity: EntityLookupMatch): OutboundMessage {
    const lines = [`🏢 *${entity.nombre}*`, `RUC ${entity.ruc}`];
    if (entity.tipoDoc) lines.push(`_${entity.tipoDoc}_`);
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: lines.join('\n'),
      buttons: [
        { id: 'entact:anuncios', title: '📅 Ver anuncios' },
        { id: 'entact:alerta', title: '🔔 Crear alerta' },
        { id: 'menu:main', title: 'Menú' },
      ],
    };
  }

  /** Lista de desambiguación cuando hay varias coincidencias. */
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
            title: truncate(m.nombre, 24),
            description: `RUC ${m.ruc}`,
          })),
        },
      ],
    };
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
