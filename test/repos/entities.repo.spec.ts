import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaEntitiesRepo } from '../../src/adapters/persistence/prisma/entities.repo';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

describe('PrismaEntitiesRepo', () => {
  const repo = new PrismaEntitiesRepo(prisma as never);

  beforeEach(async () => {
    await truncateAll(prisma);
    await repo.upsertManyByRuc([
      { ruc: '20131370645', nombre: 'MINISTERIO DE SALUD', sigla: 'MINSA' },
      { ruc: '20131380951', nombre: 'MINISTERIO DE ECONOMIA Y FINANZAS', sigla: 'MEF' },
      { ruc: '20131369000', nombre: 'SEGURO SOCIAL DE SALUD', sigla: 'ESSALUD' },
    ]);
  });

  it('searchByText encuentra por sigla exacta', async () => {
    const r = await repo.searchByText('MINSA');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].sigla).toBe('MINSA');
  });

  it('searchByText con typo encuentra similares vía trigram', async () => {
    const r = await repo.searchByText('Ministerio Salud');
    expect(r.some((e) => e.ruc === '20131370645')).toBe(true);
  });

  it('searchByText devuelve [] con query vacío', async () => {
    expect(await repo.searchByText('')).toEqual([]);
  });

  it('upsertManyByRuc actualiza en segunda corrida', async () => {
    const r = await repo.upsertManyByRuc([
      { ruc: '20131370645', nombre: 'MINISTERIO DE SALUD - NUEVO', sigla: 'MINSA' },
    ]);
    expect(r.updated).toBe(1);
    const found = await repo.findByRuc('20131370645');
    expect(found?.nombre).toBe('MINISTERIO DE SALUD - NUEVO');
  });
});
