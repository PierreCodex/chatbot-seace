-- Alertas con duración/vigencia + tier de usuario (docs/09-alertas-suscripciones.md §2.2-2.3, §10)

-- 1) Eje de duración en la alerta (NULL = indefinida, solo premium)
ALTER TABLE "subscriptions" ADD COLUMN "expires_at" TIMESTAMPTZ;

-- 2) Nuevo estado: alerta auto-expirada por el job de expiración del scheduler
ALTER TYPE "SubStatus" ADD VALUE 'expired';

-- 3) Tier del usuario (gating de frecuencias, duraciones y máx. de alertas)
CREATE TYPE "UserPlan" AS ENUM ('free', 'premium');
ALTER TABLE "wa_users" ADD COLUMN "plan" "UserPlan" NOT NULL DEFAULT 'free';
ALTER TABLE "wa_users" ADD COLUMN "plan_expires_at" TIMESTAMPTZ;