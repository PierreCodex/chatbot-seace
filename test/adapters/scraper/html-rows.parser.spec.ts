import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HtmlRowsParser } from '../../../src/adapters/scraper/seace/parsers/html-rows.parser';
import { TAB_FORM_IDS } from '../../../src/adapters/scraper/seace/seace.types';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('HtmlRowsParser · Procedimientos', () => {
  const parser = new HtmlRowsParser();
  const formId = TAB_FORM_IDS.procedimientos;

  it('parsea las 5 filas del fixture de muestra', () => {
    const { rows, totalReported, currentPage, totalPages } = parser.parseProcedimientos(
      fixture('procedimientos.sample.html'),
      formId,
    );
    expect(rows).toHaveLength(5);
    expect(totalReported).toBe(499);
    expect(currentPage).toBe(1);
    expect(totalPages).toBe(34);
  });

  it('extrae nidProceso y nidConvocatoria del onclick PrimeFaces', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(rows[0].nidProceso).toBe('1016256');
    expect(rows[0].nidConvocatoria).toBe('WKi7+XLxiySMGxp3EIz5mDFuS3MQ+0npM7yC/9UY6rj92JbnzjKI');
    expect(rows[1].nidProceso).toBe('1016257');
  });

  it('normaliza valores monetarios con separadores de miles y decimales', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(rows[0].valorReferencial).toBe('12345678.90');
    expect(rows[1].valorReferencial).toBe('250000.00');
    expect(rows[3].valorReferencial).toBe('85000.00');
  });

  it('mapea Objeto de Contratación a enum Prisma', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(rows[0].objeto).toBe('obra');
    expect(rows[1].objeto).toBe('servicio');
    expect(rows[2].objeto).toBe('bien');
    expect(rows[3].objeto).toBe('consultoria_obra');
  });

  it('extrae la versión SEACE como número', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(rows[0].versionSeace).toBe(3);
    expect(rows[4].versionSeace).toBe(2);
  });

  it('calcula un contentHash estable para la misma fila', () => {
    const r1 = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    const r2 = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(r1.rows[0].contentHash).toEqual(r2.rows[0].contentHash);
    expect(r1.rows[0].contentHash).toHaveLength(64); // sha256 hex
  });

  it('devuelve hashes distintos para filas distintas', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    const hashes = new Set(rows.map((r) => r.contentHash));
    expect(hashes.size).toBe(rows.length);
  });

  it('parsea la fecha de publicación a Date (UTC)', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    // "25/05/2026 11:30" hora Lima → 16:30 UTC
    expect(rows[0].fechaPublicacion?.toISOString()).toBe('2026-05-25T16:30:00.000Z');
  });

  it('captura códigos SNIP y CUI cuando están presentes y los deja null cuando no', () => {
    const { rows } = parser.parseProcedimientos(fixture('procedimientos.sample.html'), formId);
    expect(rows[0].codigoSnip).toBe('123456');
    expect(rows[0].codigoCui).toBe('2654321');
    expect(rows[1].codigoSnip).toBeNull();
    expect(rows[1].codigoCui).toBeNull();
  });

  it('no falla y devuelve [] cuando el datatable está vacío', () => {
    const { rows, totalReported, totalPages } = parser.parseProcedimientos(
      fixture('procedimientos.empty.html'),
      formId,
    );
    expect(rows).toEqual([]);
    expect(totalReported).toBeNull();
    expect(totalPages).toBeNull();
  });

  it('devuelve [] cuando el HTML no contiene la tabla', () => {
    const { rows } = parser.parseProcedimientos('<html><body><h1>error</h1></body></html>', formId);
    expect(rows).toEqual([]);
  });
});
