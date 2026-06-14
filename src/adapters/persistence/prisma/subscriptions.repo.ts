import { Injectable } from '@nestjs/common';
import type {
  StoredSubscription,
  SubscriptionCreateInput,
  SubscriptionsRepoPort,
} from '../../../ports/persistence/subscriptions.repo.port';
import type { SubStatus } from '../../../ports/persistence/types';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaSubscriptionsRepo implements SubscriptionsRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  create(data: SubscriptionCreateInput): Promise<StoredSubscription> {
    return this.prisma.subscription.create({
      data: {
        user: { connect: { id: data.userId } },
        tab: data.tab,
        entityRuc: data.entityRuc ?? null,
        entityNombre: data.entityNombre ?? null,
        tipoSeleccionIds: data.tipoSeleccionIds ?? [],
        objeto: data.objeto ?? null,
        departamento: data.departamento ?? null,
        keyword: data.keyword ?? null,
        valorMin: data.valorMin ?? null,
        valorMax: data.valorMax ?? null,
        frequency: data.frequency ?? 'daily',
        expiresAt: data.expiresAt ?? null,
      },
    });
  }

  findById(id: string): Promise<StoredSubscription | null> {
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  countActive(userId: string): Promise<number> {
    return this.prisma.subscription.count({ where: { userId, status: 'active' } });
  }

  findActiveMatching(
    objeto: SubscriptionCreateInput['objeto'],
    entityNombre: string | null,
  ): Promise<StoredSubscription[]> {
    const now = new Date();
    // A2 (entityNombre null) matchea cualquier anuncio del objeto; A1 solo si el
    // nombre coincide (case-insensitive) con el del anuncio.
    const scope: object[] = [{ entityNombre: null }];
    if (entityNombre) {
      scope.push({ entityNombre: { equals: entityNombre, mode: 'insensitive' } });
    }
    return this.prisma.subscription.findMany({
      where: {
        tab: 'anuncios_futuros',
        status: 'active',
        objeto: objeto ?? undefined,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{ OR: scope }],
      },
    });
  }

  listActiveByFrequency(frequency: SubscriptionCreateInput['frequency']): Promise<StoredSubscription[]> {
    const now = new Date();
    return this.prisma.subscription.findMany({
      where: {
        status: 'active',
        frequency,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  listByUser(userId: string, status?: SubStatus): Promise<StoredSubscription[]> {
    return this.prisma.subscription.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateStatus(id: string, status: SubStatus): Promise<StoredSubscription> {
    return this.prisma.subscription.update({ where: { id }, data: { status } });
  }

  markRun(id: string, hitCount: number, nextRunAt: Date | null): Promise<StoredSubscription> {
    return this.prisma.subscription.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastHitCount: hitCount,
        nextRunAt,
      },
    });
  }
}
