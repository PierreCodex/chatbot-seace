import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertNotifierService } from '../../../src/modules/alerts/alert-notifier.service';
import { AlertPresenter } from '../../../src/modules/alerts/alert.presenter';
import type { DetectedHits } from '../../../src/modules/alerts/hit-detection.service';

const subs = { listActiveByFrequency: vi.fn(), markRun: vi.fn() };
const hits = { listPending: vi.fn(), markNotified: vi.fn() };
const processes = { findManyByIds: vi.fn() };
const users = { findById: vi.fn() };
const messaging = { send: vi.fn() };
const config = { get: () => false };

function make(): AlertNotifierService {
  return new AlertNotifierService(
    subs as never,
    hits as never,
    processes as never,
    users as never,
    messaging as never,
    new AlertPresenter(),
    config as never,
  );
}

const SUB = (id: string, frequency: string) => ({
  id,
  userId: `u-${id}`,
  objeto: 'obra',
  entityNombre: null,
  frequency,
});

describe('AlertNotifierService', () => {
  let svc: AlertNotifierService;
  beforeEach(() => {
    vi.clearAllMocks();
    users.findById.mockResolvedValue({ channelUserId: '700', channel: 'telegram' });
    processes.findManyByIds.mockResolvedValue([
      { id: 'p1', entityNombre: 'GORE PIURA', descripcion: 'Obra X', fechaPublicacion: new Date() },
    ]);
    messaging.send.mockResolvedValue({ messageId: 'm1' });
    svc = make();
  });

  it('deliverPending entrega, marca notificado y registra la corrida', async () => {
    hits.listPending.mockResolvedValue([{ id: 'h1', processId: 'p1' }]);
    const n = await svc.deliverPending(SUB('s1', 'hourly') as never);
    expect(n).toBe(1);
    expect(messaging.send).toHaveBeenCalledTimes(1);
    expect((messaging.send.mock.calls[0][0] as { to: string }).to).toBe('700');
    expect(hits.markNotified).toHaveBeenCalledWith(['h1']);
    expect(subs.markRun).toHaveBeenCalledWith('s1', 1, null);
  });

  it('sin hits pendientes no envía nada', async () => {
    hits.listPending.mockResolvedValue([]);
    const n = await svc.deliverPending(SUB('s1', 'hourly') as never);
    expect(n).toBe(0);
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('si el envío falla, no marca notificado (reintenta luego)', async () => {
    hits.listPending.mockResolvedValue([{ id: 'h1', processId: 'p1' }]);
    messaging.send.mockRejectedValue(new Error('telegram down'));
    const n = await svc.deliverPending(SUB('s1', 'hourly') as never);
    expect(n).toBe(0);
    expect(hits.markNotified).not.toHaveBeenCalled();
  });

  it('notifyImmediate solo entrega las alertas hourly', async () => {
    hits.listPending.mockResolvedValue([{ id: 'h1', processId: 'p1' }]);
    const grouped: DetectedHits = new Map([
      ['s1', { sub: SUB('s1', 'hourly') as never, processIds: ['p1'] }],
      ['s2', { sub: SUB('s2', 'daily') as never, processIds: ['p2'] }],
    ]);
    await svc.notifyImmediate(grouped);
    expect(messaging.send).toHaveBeenCalledTimes(1); // solo s1 (hourly)
    expect(hits.listPending).toHaveBeenCalledWith('s1', expect.any(Number));
  });
});
