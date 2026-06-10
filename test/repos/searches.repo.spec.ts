import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaSearchesRepo } from '../../src/adapters/persistence/prisma/searches.repo';
import { PrismaWaUsersRepo } from '../../src/adapters/persistence/prisma/wa-users.repo';
import { hours, minutes } from '../../src/ports/persistence/types';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

describe('PrismaSearchesRepo', () => {
  const repo = new PrismaSearchesRepo(prisma as never);
  const users = new PrismaWaUsersRepo(prisma as never);
  let userId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    const u = await users.upsertByPhone('+51999000004');
    userId = u.id;
  });

  it('create persiste y la columna generada filters_hash queda poblada', async () => {
    const s = await repo.create({
      userId,
      tab: 'procedimientos',
      filters: { entityRuc: '20131370645', objeto: 'obra' },
      resultIds: [],
      resultCount: 0,
      source: 'live',
      durationMs: 1234,
    });
    expect(s.filtersHash).toBeTruthy();
    expect(s.filtersHash).toHaveLength(64); // sha256 hex
  });

  it('findRecentByFilters trae el más reciente cuando match exacto del hash', async () => {
    const filters = { entityRuc: '20131370645', objeto: 'obra' };
    await repo.create({
      userId,
      tab: 'procedimientos',
      filters,
      resultIds: [],
      resultCount: 5,
      source: 'live',
    });

    const found = await repo.findRecentByFilters('procedimientos', filters, hours(1));
    expect(found?.resultCount).toBe(5);
  });

  it('findRecentByFilters devuelve null si el filtro difiere', async () => {
    await repo.create({
      userId,
      tab: 'procedimientos',
      filters: { entityRuc: '20131370645' },
      resultIds: [],
      resultCount: 1,
      source: 'live',
    });
    const found = await repo.findRecentByFilters('procedimientos', { entityRuc: 'OTRO' }, hours(1));
    expect(found).toBeNull();
  });

  it('findRecentByFilters ignora resultados fuera del maxAge', async () => {
    await repo.create({
      userId,
      tab: 'procedimientos',
      filters: { entityRuc: '20131370645' },
      resultIds: [],
      resultCount: 1,
      source: 'live',
    });
    const found = await repo.findRecentByFilters(
      'procedimientos',
      { entityRuc: '20131370645' },
      minutes(0),
    );
    expect(found).toBeNull();
  });
});
