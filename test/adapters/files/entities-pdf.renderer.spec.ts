import { describe, expect, it } from 'vitest';
import { EntitiesPdfRenderer } from '../../../src/adapters/files/entities-pdf.renderer';
import type { EntityLookupMatch } from '../../../src/ports/entity-lookup.port';

function match(n: number): EntityLookupMatch {
  return { ruc: `2013131295${n}`, nombre: `MUNICIPALIDAD DISTRITAL ${n}`, tipoDoc: 'RUC' };
}

describe('EntitiesPdfRenderer', () => {
  it('renderiza un PDF válido (cabecera %PDF) con el listado de entidades', async () => {
    const buf = await new EntitiesPdfRenderer().render([match(1), match(2), match(3)]);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rinde aunque tipoDoc sea null', async () => {
    const bare: EntityLookupMatch = { ruc: '20154265061', nombre: 'GORE PIURA', tipoDoc: null };
    const buf = await new EntitiesPdfRenderer().render([bare]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});