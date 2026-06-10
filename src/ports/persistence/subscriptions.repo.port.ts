import type { Subscription as PrismaSubscription } from '@prisma/client';
import type { ObjetoContratacion, SubFrequency, SubStatus, TabName } from './types';

export type StoredSubscription = PrismaSubscription;

export interface SubscriptionCreateInput {
  userId: string;
  tab: TabName;
  entityRuc?: string | null;
  tipoSeleccionIds?: number[];
  objeto?: ObjetoContratacion | null;
  departamento?: string | null;
  keyword?: string | null;
  valorMin?: number | null;
  valorMax?: number | null;
  frequency?: SubFrequency;
}

export interface SubscriptionsRepoPort {
  create(data: SubscriptionCreateInput): Promise<StoredSubscription>;
  findById(id: string): Promise<StoredSubscription | null>;
  listByUser(userId: string, status?: SubStatus): Promise<StoredSubscription[]>;
  updateStatus(id: string, status: SubStatus): Promise<StoredSubscription>;
  markRun(id: string, hitCount: number, nextRunAt: Date | null): Promise<StoredSubscription>;
}

export const SUBSCRIPTIONS_REPO = Symbol('SUBSCRIPTIONS_REPO');
