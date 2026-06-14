import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PendingHit,
  SubscriptionHitsRepoPort,
} from '../../../ports/persistence/subscription-hits.repo.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaSubscriptionHitsRepo implements SubscriptionHitsRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIfNew(subscriptionId: string, processId: string): Promise<boolean> {
    try {
      await this.prisma.subscriptionHit.create({ data: { subscriptionId, processId } });
      return true;
    } catch (err) {
      // P2002 = violación de unique(subscriptionId, processId) → ya existía.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  listPending(subscriptionId: string, limit: number): Promise<PendingHit[]> {
    return this.prisma.subscriptionHit.findMany({
      where: { subscriptionId, notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, processId: true },
    });
  }

  async markNotified(hitIds: string[], notificationId?: string | null): Promise<void> {
    if (hitIds.length === 0) return;
    await this.prisma.subscriptionHit.updateMany({
      where: { id: { in: hitIds } },
      data: { notifiedAt: new Date(), notificationId: notificationId ?? null },
    });
  }
}
