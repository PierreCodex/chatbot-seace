import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscribeFlow } from '../../../src/modules/bot/flows/subscribe.flow';
import { PlanService } from '../../../src/modules/admin/plan.service';
import type { FlowContext } from '../../../src/modules/bot/types';

const subs = {
  create: vi.fn(),
  findById: vi.fn(),
  listByUser: vi.fn(),
  countActive: vi.fn(),
  updateStatus: vi.fn(),
  markRun: vi.fn(),
};
const admin = { findUser: vi.fn() };
const roles = { isPremiumByRole: vi.fn() };
const config = { get: () => 'telegram' };

function make(): SubscribeFlow {
  return new SubscribeFlow(
    subs as never,
    admin as never,
    roles as never,
    new PlanService(),
    config as never,
  );
}

function ctx(step: string, input: string, data: Record<string, unknown> = {}): FlowContext {
  return {
    userId: 'u1',
    phoneNumber: '700',
    phoneNumberId: 'pn1',
    input,
    notify: async () => ({ messageId: 's1' }),
    state: {
      userId: 'u1',
      phoneNumber: '700',
      phoneNumberId: 'pn1',
      flowId: 'subscribe',
      step,
      data,
      updatedAt: 0,
    },
  };
}

const LAST_ACF = {
  lastAcf: { objeto: 'obra', entityRuc: '20154265061', entityNombre: 'GORE PIURA' },
};

describe('SubscribeFlow', () => {
  let flow: SubscribeFlow;
  beforeEach(() => {
    vi.clearAllMocks();
    roles.isPremiumByRole.mockResolvedValue(false);
    admin.findUser.mockResolvedValue({ plan: 'free', planExpiresAt: null, blocked: false });
    subs.countActive.mockResolvedValue(0);
    flow = make();
  });

  it('Avísame sin búsqueda previa → vuelve al menú sin crear', async () => {
    const r = await flow.handle(ctx('initial', 'acf:subscribe', {}));
    expect(subs.create).not.toHaveBeenCalled();
    expect(r.nextFlowId).toBe('main-menu');
  });

  it('Free en el límite (3) → mensaje de cuota, no crea', async () => {
    subs.countActive.mockResolvedValue(3);
    const r = await flow.handle(ctx('initial', 'acf:subscribe', LAST_ACF));
    expect(subs.create).not.toHaveBeenCalled();
    expect((r.messages[0] as { body: string }).body).toMatch(/límite/i);
  });

  it('Free bajo el límite → pide frecuencia (solo diaria/semanal)', async () => {
    const r = await flow.handle(ctx('initial', 'acf:subscribe', LAST_ACF));
    expect(r.nextStep).toBe('awaiting-frequency');
    const m = r.messages[0];
    if (m.kind === 'buttons') {
      const ids = m.buttons.map((b) => b.id);
      expect(ids).toContain('subf:daily');
      expect(ids).toContain('subf:weekly');
      expect(ids).not.toContain('subf:hourly'); // hourly es Premium
    }
    expect(r.dataPatch?.subDraft).toMatchObject({ objeto: 'obra', entityNombre: 'GORE PIURA' });
  });

  it('Premium ve la frecuencia inmediata (hourly)', async () => {
    roles.isPremiumByRole.mockResolvedValue(true);
    const r = await flow.handle(ctx('initial', 'acf:subscribe', LAST_ACF));
    const m = r.messages[0];
    if (m.kind === 'buttons') {
      expect(m.buttons.map((b) => b.id)).toContain('subf:hourly');
    }
  });

  it('elegir frecuencia → pide duración', async () => {
    const r = await flow.handle(
      ctx('awaiting-frequency', 'subf:daily', {
        subDraft: { objeto: 'obra', entityNombre: 'GORE PIURA' },
      }),
    );
    expect(r.nextStep).toBe('awaiting-duration');
    if (r.messages[0].kind === 'buttons') {
      const ids = r.messages[0].buttons.map((b) => b.id);
      expect(ids).toContain('subd:1w');
      expect(ids).not.toContain('subd:1m'); // 1 mes es Premium
    }
  });

  it('elegir duración crea la alerta (objeto + entidad + freq + expiry)', async () => {
    subs.create.mockResolvedValue({ frequency: 'daily' });
    const r = await flow.handle(
      ctx('awaiting-duration', 'subd:1w', {
        subDraft: {
          objeto: 'obra',
          entityRuc: '20154265061',
          entityNombre: 'GORE PIURA',
          frequency: 'daily',
        },
      }),
    );
    expect(subs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        tab: 'anuncios_futuros',
        objeto: 'obra',
        entityNombre: 'GORE PIURA',
        frequency: 'daily',
      }),
    );
    const arg = subs.create.mock.calls[0][0];
    expect(arg.expiresAt).toBeInstanceOf(Date);
    expect(r.nextFlowId).toBe('main-menu');
  });

  it('Free no puede forzar duración Premium (1 mes) por callback', async () => {
    const r = await flow.handle(
      ctx('awaiting-duration', 'subd:1m', {
        subDraft: { objeto: 'obra', frequency: 'daily' },
      }),
    );
    expect(subs.create).not.toHaveBeenCalled(); // re-pide duración
    expect(r.nextStep).toBeUndefined();
  });

  it('Mis alertas vacío → vuelve al menú', async () => {
    subs.listByUser.mockResolvedValue([]);
    const r = await flow.handle(ctx('manage', 'subscriptions', {}));
    expect(r.nextFlowId).toBe('main-menu');
  });

  it('borrar alerta propia → updateStatus deleted + re-lista', async () => {
    subs.findById.mockResolvedValue({ id: 'a1', userId: 'u1' });
    subs.listByUser.mockResolvedValue([]);
    await flow.handle(ctx('manage', 'subdel:a1', {}));
    expect(subs.updateStatus).toHaveBeenCalledWith('a1', 'deleted');
  });

  it('no borra una alerta de otro usuario', async () => {
    subs.findById.mockResolvedValue({ id: 'a1', userId: 'OTRO' });
    subs.listByUser.mockResolvedValue([]);
    await flow.handle(ctx('manage', 'subdel:a1', {}));
    expect(subs.updateStatus).not.toHaveBeenCalled();
  });
});
