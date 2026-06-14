import { describe, expect, it } from 'vitest';
import { PlanService } from '../../../src/modules/admin/plan.service';

const svc = new PlanService();
const NOW = new Date('2026-06-14T12:00:00Z');

function u(p: Partial<{ blocked: boolean; plan: 'free' | 'premium'; planExpiresAt: Date | null }>) {
  return { blocked: false, plan: 'free' as const, planExpiresAt: null, ...p };
}

describe('PlanService.getEffectivePlan', () => {
  it('free → free', () => {
    expect(svc.getEffectivePlan(u({ plan: 'free' }), NOW)).toBe('free');
  });

  it('premium sin vencimiento → premium', () => {
    expect(svc.getEffectivePlan(u({ plan: 'premium', planExpiresAt: null }), NOW)).toBe('premium');
  });

  it('premium con vencimiento futuro → premium', () => {
    const future = new Date(NOW.getTime() + 86400000);
    expect(svc.getEffectivePlan(u({ plan: 'premium', planExpiresAt: future }), NOW)).toBe(
      'premium',
    );
  });

  it('premium vencido → free (lazy)', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(svc.getEffectivePlan(u({ plan: 'premium', planExpiresAt: past }), NOW)).toBe('free');
  });

  it('bloqueado → suspended (gana sobre premium)', () => {
    expect(svc.getEffectivePlan(u({ blocked: true, plan: 'premium' }), NOW)).toBe('suspended');
  });

  it('premiumByRole → premium aunque el plan en BD sea free', () => {
    expect(svc.getEffectivePlan(u({ plan: 'free' }), NOW, true)).toBe('premium');
  });

  it('premiumByRole no salva a un suspendido', () => {
    expect(svc.getEffectivePlan(u({ blocked: true, plan: 'free' }), NOW, true)).toBe('suspended');
  });
});

describe('PlanService.maxAlertas', () => {
  it('premium 10 · free 3 · suspended 0', () => {
    expect(svc.maxAlertas('premium')).toBe(10);
    expect(svc.maxAlertas('free')).toBe(3);
    expect(svc.maxAlertas('suspended')).toBe(0);
  });
});

describe('PlanService.isExpiredPremium', () => {
  it('true solo si premium con expiry pasada', () => {
    expect(
      svc.isExpiredPremium(u({ plan: 'premium', planExpiresAt: new Date(NOW.getTime() - 1) }), NOW),
    ).toBe(true);
    expect(svc.isExpiredPremium(u({ plan: 'premium', planExpiresAt: null }), NOW)).toBe(false);
    expect(svc.isExpiredPremium(u({ plan: 'free' }), NOW)).toBe(false);
  });
});
