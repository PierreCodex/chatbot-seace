import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HtmlRowsParser } from '../../../src/adapters/scraper/seace/parsers/html-rows.parser';
import { TAB_FORM_IDS } from '../../../src/adapters/scraper/seace/seace.types';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('HtmlRowsParser · Anuncios de Contratación Futura (ACF)', () => {
  const parser = new HtmlRowsParser();
  const formId = TAB_FORM_IDS.anuncios_futuros;

  it('parsea las 3 filas del fixture y el paginador', () => {
    const { rows, totalReported, currentPage, totalPages } = parser.parseAnunciosFuturos(
      fixture('anuncios-futuros.sample.html'),
      formId,
    );
    expect(rows).toHaveLength(3);
    expect(totalReported).toBe(40);
    expect(currentPage).toBe(1);
    expect(totalPages).toBe(4);
  });

  it('mapea las 10 columnas a ProcessRow', () => {
    const { rows } = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    const r0 = rows[0];
    expect(r0.tab).toBe('anuncios_futuros');
    expect(r0.entityNombre).toBe('MUNICIPALIDAD DISTRITAL DE CERRO COLORADO');
    expect(r0.tipoSeleccion).toBe('Licitación Pública');
    expect(r0.objeto).toBe('obra');
    expect(r0.descripcion).toContain('pistas y veredas');
    expect(r0.alcance).toContain('infraestructura vial');
    expect(r0.cantidad).toBe('1');
    expect(r0.plazoDias).toBe(300);
    expect(rows[1].cantidad).toBe('50');
    expect(rows[1].plazoDias).toBe(60);
  });

  it('mapea Objeto de Contratación (incluye Consultoría de Obra con acento)', () => {
    const { rows } = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    expect(rows[0].objeto).toBe('obra');
    expect(rows[1].objeto).toBe('bien');
    expect(rows[2].objeto).toBe('consultoria_obra');
  });

  it('parsea fecha de publicación (con hora) y fecha aprox. de convocatoria (sin hora) a UTC', () => {
    const { rows } = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    // 08/06/2026 15:32:00 Lima (UTC-5) → 20:32 UTC
    expect(rows[0].fechaPublicacion?.toISOString()).toBe('2026-06-08T20:32:00.000Z');
    // 20/07/2026 (sin hora) → 00:00 Lima → 05:00 UTC
    expect(rows[0].fechaAproxConv?.toISOString()).toBe('2026-07-20T05:00:00.000Z');
  });

  it('deja en null los campos que ACF no tiene (nomenclatura, ficha, valor, versión)', () => {
    const { rows } = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    const r0 = rows[0];
    expect(r0.nomenclatura).toBeNull();
    expect(r0.nidProceso).toBeNull();
    expect(r0.nidConvocatoria).toBeNull();
    expect(r0.valorReferencial).toBeNull();
    expect(r0.versionSeace).toBeNull();
    expect(r0.codigoSnip).toBeNull();
    expect(r0.codigoCui).toBeNull();
  });

  it('computa contentHash estable, de 64 hex, y distinto por fila', () => {
    const a = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    const b = parser.parseAnunciosFuturos(fixture('anuncios-futuros.sample.html'), formId);
    expect(a.rows[0].contentHash).toHaveLength(64);
    expect(a.rows[0].contentHash).toEqual(b.rows[0].contentHash); // estable
    const hashes = new Set(a.rows.map((r) => r.contentHash));
    expect(hashes.size).toBe(a.rows.length); // todas distintas
  });

  it('devuelve [] cuando el datatable está vacío', () => {
    const { rows, totalReported, totalPages } = parser.parseAnunciosFuturos(
      fixture('anuncios-futuros.empty.html'),
      formId,
    );
    expect(rows).toEqual([]);
    expect(totalReported).toBeNull();
    expect(totalPages).toBeNull();
  });

  it('devuelve [] cuando el HTML no contiene la tabla', () => {
    const { rows } = parser.parseAnunciosFuturos('<html><body>error</body></html>', formId);
    expect(rows).toEqual([]);
  });

  describe('parseAnunciosFuturosFragment (replay HTTP)', () => {
    it('parsea el datatable completo (rama tbody)', () => {
      const rows = parser.parseAnunciosFuturosFragment(fixture('anuncios-futuros.sample.html'));
      expect(rows).toHaveLength(3);
      expect(rows[0].objeto).toBe('obra');
      expect(rows[0].entityNombre).toBe('MUNICIPALIDAD DISTRITAL DE CERRO COLORADO');
    });

    it('parsea <tr> pelados sin tabla contenedora (rama paginación)', () => {
      const html = fixture('anuncios-futuros.sample.html');
      const inner = html.match(/<tbody[^>]*ui-datatable-data[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
      expect(inner).not.toBe('');
      const rows = parser.parseAnunciosFuturosFragment(inner);
      expect(rows).toHaveLength(3);
      expect(rows[2].objeto).toBe('consultoria_obra');
    });
  });
});
