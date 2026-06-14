import type { Subscription as PrismaSubscription } from '@prisma/client';
import type { ObjetoContratacion, SubFrequency, SubStatus, TabName } from './types';

export type StoredSubscription = PrismaSubscription;

export interface SubscriptionCreateInput {
  userId: string;
  tab: TabName;
  entityRuc?: string | null;
  entityNombre?: string | null;
  tipoSeleccionIds?: number[];
  objeto?: ObjetoContratacion | null;
  departamento?: string | null;
  keyword?: string | null;
  valorMin?: number | null;
  valorMax?: number | null;
  frequency?: SubFrequency;
  expiresAt?: Date | null;
}

export interface SubscriptionsRepoPort {
  create(data: SubscriptionCreateInput): Promise<StoredSubscription>;
  findById(id: string): Promise<StoredSubscription | null>;
  listByUser(userId: string, status?: SubStatus): Promise<StoredSubscription[]>;
  /** Cuenta las alertas activas de un usuario (para aplicar la cuota del plan). */
  countActive(userId: string): Promise<number>;
  updateStatus(id: string, status: SubStatus): Promise<StoredSubscription>;
  markRun(id: string, hitCount: number, nextRunAt: Date | null): Promise<StoredSubscription>;
}

export const SUBSCRIPTIONS_REPO = Symbol('SUBSCRIPTIONS_REPO');
