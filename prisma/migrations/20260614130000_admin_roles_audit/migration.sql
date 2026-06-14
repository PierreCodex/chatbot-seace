-- Sistema de roles/permisos y auditoría (docs/17). Aditiva: 2 enums + 2 tablas.
-- El `owner` NO se persiste (vive en .env OWNER_IDS, raíz de confianza inmutable).
-- Los `seller` se gestionan en BD; la auditoría es append-only e inmutable.

-- CreateEnum
CREATE TYPE "AdminActorRole" AS ENUM ('owner', 'seller', 'system');

-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('plan_activado', 'plan_extendido', 'plan_desactivado', 'auto_vencido', 'usuario_suspendido', 'usuario_reactivado', 'seller_agregado', 'seller_revocado', 'seller_revocado_emergencia', 'intento_no_autorizado');

-- CreateTable: staff con rol seller (id de Telegram como texto, igual que channel_user_id)
CREATE TABLE "bot_sellers" (
    "id" UUID NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "added_by_owner_id" TEXT NOT NULL,
    "revoked_by" TEXT,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bot_sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: bitácora append-only de acciones administrativas
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" "AdminActorRole" NOT NULL,
    "action" "AdminAction" NOT NULL,
    "target_user_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_sellers_telegram_id_key" ON "bot_sellers"("telegram_id");
CREATE INDEX "bot_sellers_active_idx" ON "bot_sellers"("active");

-- CreateIndex
CREATE INDEX "admin_audit_log_target_user_id_created_at_idx" ON "admin_audit_log"("target_user_id", "created_at" DESC);
CREATE INDEX "admin_audit_log_actor_id_created_at_idx" ON "admin_audit_log"("actor_id", "created_at" DESC);
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at" DESC);
