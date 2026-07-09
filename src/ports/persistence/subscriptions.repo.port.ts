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
  /** Tema legible de la alerta ("fibra óptica") — se muestra al usuario. */
  keyword?: string | null;
  /** Sinónimos CONGELADOS al crear (F2, docs/22): el matcher exige que la
   * descripción contenga alguno. Vacío = alerta sin tema (solo objeto/entidad). */
  keywordTerms?: string[];
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
  /**
   * Alertas ACF activas (no vencidas) que matchean un anuncio nuevo: mismo `objeto`
   * y alcance A2 (entityNombre null = todas) o A1 (entityNombre = el del anuncio).
   * `entityNombre` del anuncio puede ser null. Ver docs/09 §2.1 (matcher).
   */
  findActiveMatching(
    objeto: ObjetoContratacion,
    entityNombre: string | null,
  ): Promise<StoredSubscription[]>;
  /** Alertas activas (no vencidas) de una frecuencia dada (para el digest). */
  listActiveByFrequency(frequency: SubFrequency): Promise<StoredSubscription[]>;
  /** Marca como `expired` las alertas activas cuya vigencia (`expires_at`) ya pasó.
   * Devuelve cuántas se expiraron. */
  expireOverdue(): Promise<number>;
  updateStatus(id: string, status: SubStatus): Promise<StoredSubscription>;
  markRun(id: string, hitCount: number, nextRunAt: Date | null): Promise<StoredSubscription>;
}

export const SUBSCRIPTIONS_REPO = Symbol('SUBSCRIPTIONS_REPO');
