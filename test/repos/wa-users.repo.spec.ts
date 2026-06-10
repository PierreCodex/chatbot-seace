import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaWaUsersRepo } from '../../src/adapters/persistence/prisma/wa-users.repo';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

describe('PrismaWaUsersRepo', () => {
  const repo = new PrismaWaUsersRepo(prisma as never);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('upsertByPhone crea el usuario en el primer mensaje', async () => {
    const u = await repo.upsertByPhone('+51999000001');
    expect(u.phoneE164).toBe('+51999000001');
    expect(u.totalMessages).toBe(0n);
    expect(u.language).toBe('es-PE');
  });

  it('upsertByPhone incrementa totalMessages y actualiza lastActiveAt', async () => {
    const u1 = await repo.upsertByPhone('+51999000002');
    const u2 = await repo.upsertByPhone('+51999000002');
    const u3 = await repo.upsertByPhone('+51999000002');
    expect(u1.id).toBe(u2.id);
    expect(u2.id).toBe(u3.id);
    expect(u3.totalMessages).toBe(2n);
    expect(u3.lastActiveAt.getTime()).toBeGreaterThanOrEqual(u1.lastActiveAt.getTime());
  });

  it('findByPhone devuelve null si no existe', async () => {
    expect(await repo.findByPhone('+51999999999')).toBeNull();
  });
});
