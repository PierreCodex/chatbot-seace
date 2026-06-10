/*
  Warnings:

  - You are about to drop the `health_checks` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ProcesoTab" AS ENUM ('procedimientos', 'anuncios_futuros', 'expresiones_interes', 'difusion_requerimientos', 'orden_compra_servicio', 'condiciones_contratacion');

-- CreateEnum
CREATE TYPE "ObjetoContratacion" AS ENUM ('bien', 'servicio', 'obra', 'consultoria_obra');

-- CreateEnum
CREATE TYPE "SubFrequency" AS ENUM ('hourly', 'daily', 'weekly');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('active', 'paused', 'deleted');

-- CreateEnum
CREATE TYPE "NotifKind" AS ENUM ('search_result', 'subscription_hit', 'file_delivery', 'system_message', 'template');

-- CreateEnum
CREATE TYPE "NotifStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'dlq');

-- CreateEnum
CREATE TYPE "FileOrigin" AS ENUM ('seace_repository', 'export_excel', 'ficha_pdf');

-- DropTable
DROP TABLE "health_checks";

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "ruc" VARCHAR(11) NOT NULL,
    "nombre" TEXT NOT NULL,
    "sigla" TEXT,
    "tipo_doc" TEXT,
    "ultimo_visto" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processes" (
    "id" UUID NOT NULL,
    "tab" "ProcesoTab" NOT NULL,
    "nomenclatura" TEXT,
    "entity_ruc" VARCHAR(11),
    "entity_nombre" TEXT NOT NULL,
    "fecha_publicacion" TIMESTAMPTZ,
    "tipo_seleccion" TEXT,
    "tipo_seleccion_id" INTEGER,
    "objeto" "ObjetoContratacion",
    "descripcion" TEXT,
    "alcance" TEXT,
    "cantidad" DECIMAL,
    "plazo_dias" INTEGER,
    "fecha_aprox_conv" DATE,
    "codigo_snip" TEXT,
    "codigo_cui" TEXT,
    "valor_referencial" DECIMAL(18,2),
    "moneda" TEXT,
    "version_seace" SMALLINT,
    "nid_proceso" TEXT,
    "nid_convocatoria" TEXT,
    "url_repositorio" TEXT,
    "content_hash" TEXT NOT NULL,
    "scraped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_changed_at" TIMESTAMPTZ,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_history" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_users" (
    "id" UUID NOT NULL,
    "phone_e164" VARCHAR(20) NOT NULL,
    "display_name" TEXT,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_messages" BIGINT NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'es-PE',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wa_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tab" "ProcesoTab" NOT NULL,
    "entity_ruc" VARCHAR(11),
    "tipo_seleccion_ids" INTEGER[],
    "objeto" "ObjetoContratacion",
    "departamento" TEXT,
    "keyword" TEXT,
    "valor_min" DECIMAL(18,2),
    "valor_max" DECIMAL(18,2),
    "frequency" "SubFrequency" NOT NULL DEFAULT 'daily',
    "status" "SubStatus" NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMPTZ,
    "last_hit_count" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_hits" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "notified_at" TIMESTAMPTZ,
    "notification_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "searches" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "tab" "ProcesoTab" NOT NULL,
    "filters" JSONB NOT NULL,
    "filters_hash" TEXT,
    "result_count" INTEGER,
    "result_ids" UUID[],
    "source" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "NotifKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotifStatus" NOT NULL DEFAULT 'queued',
    "kapso_msg_id" TEXT,
    "error" TEXT,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "user_id" UUID NOT NULL,
    "flow" TEXT,
    "step" TEXT,
    "filters" JSONB,
    "expires_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "worker_id" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "process_id" UUID,
    "origin" "FileOrigin" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "mime_type" TEXT,
    "original_name" TEXT,
    "sha256" TEXT,
    "downloaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entities_ruc_key" ON "entities"("ruc");

-- CreateIndex
CREATE INDEX "entities_nombre_idx" ON "entities"("nombre");

-- CreateIndex
CREATE INDEX "entities_sigla_idx" ON "entities"("sigla");

-- CreateIndex
CREATE INDEX "processes_entity_ruc_idx" ON "processes"("entity_ruc");

-- CreateIndex
CREATE INDEX "processes_fecha_publicacion_idx" ON "processes"("fecha_publicacion" DESC);

-- CreateIndex
CREATE INDEX "processes_objeto_idx" ON "processes"("objeto");

-- CreateIndex
CREATE INDEX "processes_nid_proceso_idx" ON "processes"("nid_proceso");

-- CreateIndex
CREATE UNIQUE INDEX "processes_tab_nomenclatura_version_seace_key" ON "processes"("tab", "nomenclatura", "version_seace");

-- CreateIndex
CREATE INDEX "process_history_process_id_observed_at_idx" ON "process_history"("process_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wa_users_phone_e164_key" ON "wa_users"("phone_e164");

-- CreateIndex
CREATE INDEX "wa_users_phone_e164_idx" ON "wa_users"("phone_e164");

-- CreateIndex
CREATE INDEX "subscriptions_status_next_run_at_idx" ON "subscriptions"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscription_hits_subscription_id_created_at_idx" ON "subscription_hits"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_hits_subscription_id_process_id_key" ON "subscription_hits"("subscription_id", "process_id");

-- CreateIndex
CREATE INDEX "searches_user_id_created_at_idx" ON "searches"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "searches_filters_hash_created_at_idx" ON "searches"("filters_hash", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "scrape_jobs_status_created_at_idx" ON "scrape_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "scrape_jobs_job_type_created_at_idx" ON "scrape_jobs"("job_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "files_process_id_idx" ON "files"("process_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_process_id_origin_original_name_key" ON "files"("process_id", "origin", "original_name");

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_entity_ruc_fkey" FOREIGN KEY ("entity_ruc") REFERENCES "entities"("ruc") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_history" ADD CONSTRAINT "process_history_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wa_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_hits" ADD CONSTRAINT "subscription_hits_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_hits" ADD CONSTRAINT "subscription_hits_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wa_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wa_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wa_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Extras no modelables en Prisma:
--   1. Índices GIN trigram para búsqueda ILIKE rápida (pg_trgm)
--   2. Triggers de updated_at por tabla (función creada en la migración
--      previa _extensions_and_helpers)
--   3. searches.filters_hash como GENERATED ALWAYS AS ... STORED
-- ---------------------------------------------------------------------

-- 1. GIN trigram
CREATE INDEX "entities_nombre_trgm"   ON "entities"   USING gin (nombre   gin_trgm_ops);
CREATE INDEX "entities_sigla_trgm"    ON "entities"   USING gin (sigla    gin_trgm_ops);
CREATE INDEX "processes_descripcion_trgm" ON "processes" USING gin (descripcion gin_trgm_ops);

-- 2. Triggers de updated_at en las tablas con la columna
CREATE TRIGGER trg_entities_updated_at     BEFORE UPDATE ON "entities"     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_processes_updated_at    BEFORE UPDATE ON "processes"    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wa_users_updated_at     BEFORE UPDATE ON "wa_users"     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subs_updated_at         BEFORE UPDATE ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON "conversations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. filters_hash como GENERATED ALWAYS AS ... STORED.
-- Prisma la creó como TEXT nullable; la reemplazamos por una columna
-- calculada en SQL (Prisma seguirá leyéndola; las escrituras vía Prisma
-- no deben tocarla — el repo nunca le pasa filtersHash al .create()).
DROP INDEX IF EXISTS "searches_filters_hash_created_at_idx";
ALTER TABLE "searches" DROP COLUMN "filters_hash";
ALTER TABLE "searches" ADD COLUMN "filters_hash" text
  GENERATED ALWAYS AS (encode(digest(filters::text, 'sha256'), 'hex')) STORED;
CREATE INDEX "searches_filters_hash_created_at_idx" ON "searches"("filters_hash", "created_at" DESC);
