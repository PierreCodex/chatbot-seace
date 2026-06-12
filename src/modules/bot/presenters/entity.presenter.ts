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
 *  - `card`: ficha de una entidad (RUC) + navegación (Otra entidad / Menú).
 *  - `disambiguation`: lista de coincidencias cuando hay varias.
 */
@Injectable()
export class EntityResultsPresenter {
  /** Ficha de una entidad ya resuelta con sus acciones. */
  card(ctx: EntityPresentContext, entity: EntityLookupMatch): OutboundMessage {
    const lines = [`🏢 *${entity.nombre}*`, `RUC ${entity.ruc}`];
    if (entity.tipoDoc && entity.tipoDoc.toUpperCase() !== 'RUC') lines.push(`_${entity.tipoDoc}_`);
    // Resolvedor = solo consulta de RUC. Para ver anuncios de la entidad, el
    // usuario vuelve al menú y elige "Anuncios futuros" (allí filtra por entidad).
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
            // El título de fila topa en 24 chars (límite de WhatsApp) → abreviamos
            // el prefijo común para que se vea la parte distintiva; el nombre
            // completo va en la descripción (hasta 72).
            title: entityTitle(m.nombre),
            description: truncate(`${m.nombre} · RUC ${m.ruc}`, 72),
          })),
        },
      ],
    };
  }
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
