import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaProcessesRepo } from '../../src/adapters/persistence/prisma/processes.repo';
import type { ProcessRow } from '../../src/ports/persistence/types';
import { minutes } from '../../src/ports/persistence/types';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

function makeRow(overrides: Partial<ProcessRow> = {}): ProcessRow {
  const base: ProcessRow = {
    tab: 'procedimientos',
    nomenclatura: 'LP-001-2026-MINSA/CS-1',
    entityRuc: '20131370645',
    entityNombre: 'MINISTERIO DE SALUD',
    fechaPublicacion: new Date('2026-05-20T10:00:00Z'),
    tipoSeleccion: 'Licitación Pública',
    tipoSeleccionId: 790,
    objeto: 'obra',
    descripcion: 'CONSTRUCCION HOSPITAL X',
    alcance: null,
    cantidad: null,
    plazoDias: 180,
    fechaAproxConv: null,
    codigoSnip: null,
    codigoCui: null,
    valorReferencial: '5000000.00',
    moneda: 'PEN',
    versionSeace: 3,
    nidProceso: '12345',
    nidConvocatoria: 'abc-efimero',
    urlRepositorio: null,
    contentHash: '',
    raw: { source: 'spec' },
  };
  const merged = { ...base, ...overrides };
  merged.contentHash = createHash('sha256')
    .update(JSON.stringify({ ...merged, contentHash: undefined, nidConvocatoria: undefined }))
    .digest('hex');
  return merged;
}

function makeAcfRow(overrides: Partial<ProcessRow> = {}): ProcessRow {
  return makeRow({
    tab: 'anuncios_futuros',
    nomenclatura: null,
    versionSeace: null,
    nidProceso: null,
    nidConvocatoria: null,
    entityRuc: null,
    valorReferencial: null,
    moneda: null,
    codigoSnip: null,
    codigoCui: null,
    entityNombre: 'MUNICIPALIDAD DISTRITAL DE CERRO COLORADO',
    objeto: 'obra',
    descripcion: 'Mejoramiento de pistas y veredas',
    alcance: 'Ejecución de obra de infraestructura vial',
    cantidad: '1',
    plazoDias: 300,
    fechaAproxConv: new Date('2026-07-20T05:00:00Z'),
    ...overrides,
  });
}

describe('PrismaProcessesRepo', () => {
  const repo = new PrismaProcessesRepo(prisma as never);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('upsertMany inserta filas nuevas y crea la entidad asociada por RUC', async () => {
    const r = await repo.upsertMany([makeRow()]);
    expect(r).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    expect(r.ids).toHaveLength(1);
    const ent = await prisma.entity.findUnique({ where: { ruc: '20131370645' } });
    expect(ent?.nombre).toBe('MINISTERIO DE SALUD');
  });

  it('upsertMany detecta no-cambio cuando content_hash es idéntico', async () => {
    const row = makeRow();
    await repo.upsertMany([row]);
    const r2 = await repo.upsertMany([row]);
    expect(r2).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(r2.ids).toHaveLength(1);
  });

  it('upsertMany detecta cambio cuando content_hash difiere', async () => {
    const row = makeRow();
    await repo.upsertMany([row]);
    const updated = makeRow({ descripcion: 'CONSTRUCCION HOSPITAL X - REV 2' });
    const r2 = await repo.upsertMany([updated]);
    expect(r2).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    expect(r2.ids).toHaveLength(1);
  });

  it('upsertMany (ACF sin nomenclatura) deduplica por content_hash: 2 idénticas → 1 insert + 1 unchanged', async () => {
    const row = makeAcfRow();
    const r1 = await repo.upsertMany([row]);
    expect(r1).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    const r2 = await repo.upsertMany([row]);
    expect(r2).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(r2.ids[0]).toBe(r1.ids[0]); // misma fila física
    const count = await prisma.process.count({ where: { tab: 'anuncios_futuros' } });
    expect(count).toBe(1);
  });

  it('upsertMany (ACF) inserta como nuevas las filas con content_hash distinto', async () => {
    const a = makeAcfRow();
    const b = makeAcfRow({
      entityNombre: 'GOBIERNO REGIONAL DE PIURA',
      descripcion: 'Adquisición de equipos médicos',
    });
    const r = await repo.upsertMany([a, b]);
    expect(r.inserted).toBe(2);
    const count = await prisma.process.count({ where: { tab: 'anuncios_futuros' } });
    expect(count).toBe(2);
  });

  it('findByFilters filtra por objeto + entidad y respeta freshness', async () => {
    await repo.upsertMany([
      makeRow({ nomenclatura: 'LP-A', versionSeace: 3, objeto: 'obra' }),
      makeRow({ nomenclatura: 'LP-B', versionSeace: 3, objeto: 'servicio' }),
    ]);
    const obras = await repo.findByFilters('procedimientos', {
      entityRuc: '20131370645',
      objeto: 'obra',
    });
    expect(obras).toHaveLength(1);
    expect(obras[0].procedimiento?.nomenclatura).toBe('LP-A');

    const stale = await repo.findByFilters(
      'procedimientos',
      { entityRuc: '20131370645' },
      { maxAge: minutes(0) },
    );
    expect(stale).toHaveLength(0);
  });
});
