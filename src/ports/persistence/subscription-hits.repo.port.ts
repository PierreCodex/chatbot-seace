/** Hit = un proceso que matcheó una suscripción. `unique(subscriptionId, processId)`
 * evita duplicados; `notifiedAt` marca si ya se entregó. Ver docs/09 §2.1. */
export interface PendingHit {
  id: string;
  processId: string;
}

export interface SubscriptionHitsRepoPort {
  /** Crea el hit si no existía. `true` = recién creado (dispara aviso). */
  createIfNew(subscriptionId: string, processId: string): Promise<boolean>;
  /** Hits sin notificar de una suscripción (orden de creación). */
  listPending(subscriptionId: string, limit: number): Promise<PendingHit[]>;
  markNotified(hitIds: string[], notificationId?: string | null): Promise<void>;
}

export const SUBSCRIPTION_HITS_REPO = Symbol('SUBSCRIPTION_HITS_REPO');
