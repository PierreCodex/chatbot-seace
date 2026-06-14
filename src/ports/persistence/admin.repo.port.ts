import type {
  AdminAction,
  AdminActorRole,
  AdminAuditLog,
  BotSeller,
  UserPlan,
  WaUser,
} from '@prisma/client';

export type StoredSeller = BotSeller;
export type StoredAudit = AdminAuditLog;
export type StoredAdminUser = WaUser;

/** Snapshot mínimo guardado en `before`/`after` del audit (reconstruye el cambio). */
export interface PlanSnapshot {
  plan: UserPlan;
  planExpiresAt: string | null;
  blocked: boolean;
}

export interface AuditEntry {
  actorId: string;
  actorRole: AdminActorRole;
  action: AdminAction;
  targetUserId?: string | null;
  before?: PlanSnapshot | null;
  after?: PlanSnapshot | null;
  note?: string | null;
}

export interface SetPlanArgs {
  /** id de Telegram del usuario destino. */
  targetUserId: string;
  plan: UserPlan;
  planExpiresAt: Date | null;
  actorId: string;
  actorRole: AdminActorRole;
  /** plan_activado | plan_extendido | plan_desactivado | auto_vencido */
  action: AdminAction;
  note?: string | null;
}

export interface SetBlockedArgs {
  targetUserId: string;
  blocked: boolean;
  actorId: string;
  actorRole: AdminActorRole;
  note?: string | null;
}

/**
 * Repo del dominio de administración (roles/planes/auditoría). Concentra las
 * operaciones **transaccionales** (cambio de plan/estado + su registro de
 * auditoría en una sola transacción) para que no existan cambios sin rastro.
 * Ver docs/17. Identificación de usuarios/sellers por id numérico de Telegram.
 */
export interface AdminRepoPort {
  // ── sellers ──
  findActiveSeller(telegramId: string): Promise<StoredSeller | null>;
  listSellers(opts?: { includeRevoked?: boolean }): Promise<StoredSeller[]>;
  /** Alta/reactivación de seller + audit (transaccional). */
  addSeller(args: {
    telegramId: string;
    ownerId: string;
    note?: string | null;
  }): Promise<StoredSeller>;
  /** Baja de seller + audit (transaccional). `null` si no existía. */
  revokeSeller(args: {
    telegramId: string;
    byId: string;
    emergency?: boolean;
  }): Promise<StoredSeller | null>;

  // ── usuarios (por id de Telegram) ──
  findUser(telegramId: string): Promise<StoredAdminUser | null>;
  /** Cambio de plan + audit (transaccional). Lanza `USER_NOT_FOUND` si no existe. */
  setPlan(args: SetPlanArgs): Promise<StoredAdminUser>;
  /** Suspender/reactivar + audit (transaccional). */
  setBlocked(args: SetBlockedArgs): Promise<StoredAdminUser>;
  listActivePremium(limit: number): Promise<StoredAdminUser[]>;
  listExpiringSoon(days: number, limit: number): Promise<StoredAdminUser[]>;
  /** Cron de vencimiento: baja a free los premium vencidos + audit `auto_vencido`. */
  expireOverdue(actorId: string): Promise<StoredAdminUser[]>;

  // ── auditoría ──
  /** Registro suelto (no transaccional), p.ej. `intento_no_autorizado`. */
  log(entry: AuditEntry): Promise<void>;
  listAuditByTarget(telegramId: string, limit: number): Promise<StoredAudit[]>;
  listAuditByActor(actorId: string, limit: number): Promise<StoredAudit[]>;
  listAuditRecent(limit: number): Promise<StoredAudit[]>;
}

export const ADMIN_REPO = Symbol('ADMIN_REPO');
