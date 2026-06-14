import { Injectable } from '@nestjs/common';
import type { UserPlan } from '@prisma/client';

export type EffectivePlan = 'free' | 'premium' | 'suspended';

/** Vista mínima de un usuario para resolver su plan efectivo. */
export interface PlanUserView {
  blocked: boolean;
  plan: UserPlan;
  planExpiresAt: Date | null;
}

const MAX_ALERTAS: Record<EffectivePlan, number> = {
  premium: 10,
  free: 3,
  suspended: 0,
};

/**
 * Plan efectivo = única fuente de verdad del acceso. Aplica el vencimiento de
 * forma **lazy** (un premium vencido se trata como free aunque el cron no haya
 * corrido) y la suspensión (`blocked`). Ver docs/17 §6, §7.
 */
@Injectable()
export class PlanService {
  getEffectivePlan(u: PlanUserView, now: Date = new Date()): EffectivePlan {
    if (u.blocked) return 'suspended';
    if (
      u.plan === 'premium' &&
      (u.planExpiresAt === null || u.planExpiresAt.getTime() > now.getTime())
    ) {
      return 'premium';
    }
    return 'free';
  }

  /** Cuota de alertas del plan efectivo (free 3 / premium 10 / suspendido 0). */
  maxAlertas(plan: EffectivePlan): number {
    return MAX_ALERTAS[plan];
  }

  /** ¿El premium está vencido (premium en BD pero expiry pasada)? Para el cron. */
  isExpiredPremium(u: PlanUserView, now: Date = new Date()): boolean {
    return (
      u.plan === 'premium' && u.planExpiresAt !== null && u.planExpiresAt.getTime() <= now.getTime()
    );
  }
}
