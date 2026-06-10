-- CTI (Class Table Inheritance): se parte `processes` en una base con los campos
-- COMPARTIDOS por todas las pestañas + identidad/dedup + relaciones, y dos tablas
-- de detalle 1:1 (`process_acf`, `process_procedimiento`) con los campos propios
-- de cada pestaña. Ver docs/11-planes.md y la decisión CTI.
--
-- Los datos de `processes` son de prueba (pre-launch): se limpian con
-- TRUNCATE ... CASCADE, que SOLO afecta a `processes` y a las tablas que la
-- referencian por FK (process_history, subscription_hits, files). NO toca
-- `entities`, `wa_users`, `subscriptions`, etc.

-- 1) Limpieza acotada
TRUNCATE TABLE "processes" CASCADE;

-- 2) Soltar el índice parcial de dedup ACF (lo reemplaza la unique por dedupe_key)
DROP INDEX IF EXISTS "processes_acf_tab_content_hash_key";

-- 3) Base: quitar columnas específicas de cada pestaña (sus índices/unique caen con ellas)
ALTER TABLE "processes"
  DROP COLUMN "nomenclatura",
  DROP COLUMN "tipo_seleccion",
  DROP COLUMN "tipo_seleccion_id",
  DROP COLUMN "alcance",
  DROP COLUMN "cantidad",
  DROP COLUMN "plazo_dias",
  DROP COLUMN "fecha_aprox_conv",
  DROP COLUMN "codigo_snip",
  DROP COLUMN "codigo_cui",
  DROP COLUMN "valor_referencial",
  DROP COLUMN "moneda",
  DROP COLUMN "version_seace",
  DROP COLUMN "nid_proceso",
  DROP COLUMN "nid_convocatoria",
  DROP COLUMN "url_repositorio";

-- 4) Base: identidad por pestaña (ACF = contentHash, Procedimientos = nomenclatura|versión)
ALTER TABLE "processes" ADD COLUMN "dedupe_key" TEXT NOT NULL;
CREATE UNIQUE INDEX "processes_tab_dedupe_key_key" ON "processes"("tab", "dedupe_key");

-- 5) Detalle ACF (1:1)
CREATE TABLE "process_acf" (
    "process_id" UUID NOT NULL,
    "tipo_seleccion" TEXT,
    "alcance" TEXT,
    "cantidad" DECIMAL,
    "plazo_dias" INTEGER,
    "fecha_aprox_conv" DATE,
    CONSTRAINT "process_acf_pkey" PRIMARY KEY ("process_id")
);
ALTER TABLE "process_acf" ADD CONSTRAINT "process_acf_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6) Detalle Procedimientos (1:1) — tabla creada para mantener la base limpia y el
--    path legacy tipado; las features de esta pestaña quedan para fase posterior.
CREATE TABLE "process_procedimiento" (
    "process_id" UUID NOT NULL,
    "nomenclatura" TEXT,
    "reiniciado_desde" TEXT,
    "tipo_seleccion_id" INTEGER,
    "codigo_snip" TEXT,
    "codigo_cui" TEXT,
    "valor_referencial" DECIMAL(18,2),
    "moneda" TEXT,
    "version_seace" SMALLINT,
    "nid_proceso" TEXT,
    "nid_convocatoria" TEXT,
    "url_repositorio" TEXT,
    CONSTRAINT "process_procedimiento_pkey" PRIMARY KEY ("process_id")
);
CREATE INDEX "process_procedimiento_nid_proceso_idx" ON "process_procedimiento"("nid_proceso");
ALTER TABLE "process_procedimiento" ADD CONSTRAINT "process_procedimiento_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
