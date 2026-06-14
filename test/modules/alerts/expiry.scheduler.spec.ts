import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpiryScheduler } from '../../../src/modules/alerts/expiry.scheduler';

const subs = { expireOverdue: vi.fn() };
const admin = { expireOverdue: vi.fn() };
const messaging = { send: vi.fn() };
const config = { get: () => true };

function make(): ExpiryScheduler {
  return new ExpiryScheduler(subs as never, admin as never, messaging as never, config as never);
}

describe('ExpiryScheduler.runOnce', () => {
  let svc: ExpiryScheduler;
  beforeEach(() => {
    vi.clearAllMocks();
    messaging.send.mockResolvedValue({ messageId: 'm1' });
    svc = make();
  });

  it('expira alertas y baja premium vencidos, avisando solo a los de Telegram', async () => {
    subs.expireOverdue.mockResolvedValue(2);
    admin.expireOverdue.mockResolvedValue([
      { channel: 'telegram', channelUserId: '700' },
      { channel: 'whatsapp', channelUserId: '+51999' },
    ]);
    const r = await svc.runOnce();
    expect(subs.expireOverdue).toHaveBeenCalledTimes(1);
    expect(admin.expireOverdue).toHaveBeenCalledWith('system');
    expect(messaging.send).toHaveBeenCalledTimes(1); // solo el de Telegram
    expect((messaging.send.mock.calls[0][0] as { to: string }).to).toBe('700');
    expect(r).toEqual({ expiredSubs: 2, downgraded: 2 });
  });

  it('sin vencimientos no envía nada', async () => {
    subs.expireOverdue.mockResolvedValue(0);
    admin.expireOverdue.mockResolvedValue([]);
    const r = await svc.runOnce();
    expect(messaging.send).not.toHaveBeenCalled();
    expect(r).toEqual({ expiredSubs: 0, downgraded: 0 });
  });

  it('un aviso que falla no rompe la pasada', async () => {
    subs.expireOverdue.mockResolvedValue(0);
    admin.expireOverdue.mockResolvedValue([{ channel: 'telegram', channelUserId: '700' }]);
    messaging.send.mockRejectedValue(new Error('down'));
    const r = await svc.runOnce();
    expect(r.downgraded).toBe(1);
  });
});
