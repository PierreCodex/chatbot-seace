-- Extensiones requeridas por el schema (gen_random_uuid, búsqueda trigram)
-- y la función genérica de updated_at usada por triggers en cada tabla.
-- Esta migración va aparte de la generada por Prisma para mantener visibles
-- los pre-requisitos del schema completo.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
