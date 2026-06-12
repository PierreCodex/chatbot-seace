import { describe, expect, it } from 'vitest';
import { AcfPdfRenderer } from '../../../src/adapters/files/acf-pdf.renderer';
import type { StoredProcess } from '../../../src/ports/persistence/processes.repo.port';

function proc(n: number): StoredProcess {
  return {
    entityNombre: `MUNICIPALIDAD DISTRITAL ${n}`,
    fechaPublicacion: new Date('2026-06-08T12:00:00Z'),
    objeto: 'obra',
    descripcion: `Mejoramiento de pistas y veredas ${n}`,
    acf: {
      tipoSeleccion: 'Licitación Pública',
      fechaAproxConv: new Date('2026-07-01'),
      plazoDias: 30,
    },
    procedimiento: null,
  } as unknown as StoredProcess;
}

describe('AcfPdfRenderer', () => {
  it('renderiza un PDF válido (cabecera %PDF) con los anuncios', async () => {
    const buf = await new AcfPdfRenderer().render([proc(1), proc(2), proc(3)]);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rinde aunque falten campos opcionales (acf null)', async () => {
    const bare = {
      entityNombre: 'ENTIDAD X',
      acf: null,
      procedimiento: null,
    } as unknown as StoredProcess;
    const buf = await new AcfPdfRenderer().render([bare]);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
