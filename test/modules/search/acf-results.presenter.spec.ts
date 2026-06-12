import { describe, expect, it } from 'vitest';
import { AcfResultsPresenter } from '../../../src/modules/search/presenters/acf-results.presenter';
import type { StoredProcess } from '../../../src/ports/persistence/processes.repo.port';

function makeAcf(o: Partial<StoredProcess> = {}): StoredProcess {
  const { acf, ...rest } = o as Record<string, unknown> & { acf?: Record<string, unknown> };
  return {
    entityNombre: 'MUNICIPALIDAD DISTRITAL DE PUQUINA',
    fechaPublicacion: new Date('2026-06-08T20:32:00Z'),
    objeto: 'obra',
    descripcion: 'Mejoramiento de pistas y veredas',
    procedimiento: null,
    acf: {
      tipoSeleccion: 'Licitación Pública',
      plazoDias: 300,
      fechaAproxConv: new Date('2026-07-20T05:00:00Z'),
      ...acf,
    },
    ...rest,
  } as unknown as StoredProcess;
}

const present = (processes: StoredProcess[], totalFound: number, pdfUrl?: string) => ({
  phoneNumber: '+51999',
  phoneNumberId: 'pn1',
  totalFound,
  processes,
  pdfUrl,
});

describe('AcfResultsPresenter', () => {
  const p = new AcfResultsPresenter();

  it('0 resultados → un solo mensaje de texto claro', () => {
    const msgs = p.build(present([], 0));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('text');
  });

  it('≤5 → header + tarjetas + footer con botones ACF', () => {
    const msgs = p.build(present([makeAcf(), makeAcf({ entityNombre: 'GORE PIURA' })], 2));
    expect(msgs).toHaveLength(1 + 2 + 1);
    const footer = msgs[msgs.length - 1];
    expect(footer.kind).toBe('buttons');
    if (footer.kind === 'buttons') {
      expect(footer.buttons.map((b) => b.id)).toEqual(['acf:subscribe', 'acf:refine', 'menu:main']);
    }
  });

  it('>5 → muestra 5 tarjetas y el header menciona el total', () => {
    const procs = Array.from({ length: 8 }, () => makeAcf());
    const msgs = p.build(present(procs, 40));
    expect(msgs).toHaveLength(1 + 5 + 1);
    const header = msgs[0];
    if (header.kind === 'text') expect(header.body).toContain('40');
  });

  it('>5 con pdfUrl → adjunta documento PDF y el header lo anuncia', () => {
    const procs = Array.from({ length: 8 }, () => makeAcf());
    const msgs = p.build(present(procs, 40, 'https://files.example/acf.pdf'));
    // header + 5 tarjetas + documento + footer
    expect(msgs).toHaveLength(1 + 5 + 1 + 1);
    const doc = msgs.find((m) => m.kind === 'document');
    expect(doc).toBeDefined();
    if (doc && doc.kind === 'document') {
      expect(doc.link).toBe('https://files.example/acf.pdf');
      expect(doc.filename).toBe('anuncios-futuros.pdf');
    }
    const header = msgs[0];
    if (header.kind === 'text') expect(header.body).toContain('PDF');
  });

  it('≤5 NO adjunta documento aunque venga pdfUrl', () => {
    const msgs = p.build(present([makeAcf()], 1, 'https://files.example/acf.pdf'));
    expect(msgs.some((m) => m.kind === 'document')).toBe(false);
  });

  it('la tarjeta incluye entidad, plazo y conv. aprox. (sin ficha/bases)', () => {
    const card = p.build(present([makeAcf()], 1))[1];
    if (card.kind === 'text') {
      expect(card.body).toContain('PUQUINA');
      expect(card.body).toContain('300 días');
      expect(card.body).not.toContain('Ver ficha');
    }
  });
});
