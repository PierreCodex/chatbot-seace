import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaNotificationsRepo } from '../../src/adapters/persistence/prisma/notifications.repo';
import { PrismaWaUsersRepo } from '../../src/adapters/persistence/prisma/wa-users.repo';
import { prisma } from '../setup';
import { truncateAll } from '../helpers/truncate';

describe('PrismaNotificationsRepo', () => {
  const repo = new PrismaNotificationsRepo(prisma as never);
  const users = new PrismaWaUsersRepo(prisma as never);
  let userId: string;

  beforeEach(async () => {
    await truncateAll(prisma);
    const u = await users.upsertByPhone('+51999000005');
    userId = u.id;
  });

  it('create persiste con status queued', async () => {
    const n = await repo.create({
      userId,
      kind: 'subscription_hit',
      payload: { matches: 3 },
    });
    expect(n.status).toBe('queued');
    expect(n.attempts).toBe(0);
  });

  it('markSent setea kapsoMsgId, sentAt y cambia status', async () => {
    const n = await repo.create({ userId, kind: 'search_result', payload: {} });
    const sent = await repo.markSent(n.id, 'kapso-msg-xyz');
    expect(sent.status).toBe('sent');
    expect(sent.kapsoMsgId).toBe('kapso-msg-xyz');
    expect(sent.sentAt).not.toBeNull();
  });

  it('markFailed incrementa attempts y persiste el error', async () => {
    const n = await repo.create({ userId, kind: 'system_message', payload: {} });
    const f1 = await repo.markFailed(n.id, 'http 500');
    expect(f1.attempts).toBe(1);
    expect(f1.error).toBe('http 500');
    const f2 = await repo.markFailed(n.id, 'http 500');
    expect(f2.attempts).toBe(2);
  });
});
