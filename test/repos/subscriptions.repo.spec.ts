import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaSubscriptionsRepo } from '../../src/adapters/persistence/prisma/subscriptions.repo';
import { PrismaWaUsersRepo } from '../../src/adapters/persistence/prisma/wa-users.repo';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

describe('PrismaSubscriptionsRepo', () => {
  const subs = new PrismaSubscriptionsRepo(prisma as never);
  const users = new PrismaWaUsersRepo(prisma as never);
  let userId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    const u = await users.upsertByPhone('+51999000003');
    userId = u.id;
  });

  it('create persiste con frequency default daily y status active', async () => {
    const s = await subs.create({
      userId,
      tab: 'procedimientos',
      objeto: 'obra',
    });
    expect(s.frequency).toBe('daily');
    expect(s.status).toBe('active');
    expect(s.tipoSeleccionIds).toEqual([]);
  });

  it('listByUser solo trae las del usuario y filtra por status', async () => {
    await subs.create({ userId, tab: 'procedimientos' });
    const second = await subs.create({ userId, tab: 'anuncios_futuros' });
    await subs.updateStatus(second.id, 'paused');

    const active = await subs.listByUser(userId, 'active');
    expect(active).toHaveLength(1);
    expect(active[0].tab).toBe('procedimientos');

    const all = await subs.listByUser(userId);
    expect(all).toHaveLength(2);
  });

  it('markRun setea last_run_at, last_hit_count y next_run_at', async () => {
    const s = await subs.create({ userId, tab: 'procedimientos' });
    const next = new Date(Date.now() + 86_400_000);
    const updated = await subs.markRun(s.id, 7, next);
    expect(updated.lastHitCount).toBe(7);
    expect(updated.lastRunAt).not.toBeNull();
    expect(updated.nextRunAt?.toISOString()).toBe(next.toISOString());
  });
});
