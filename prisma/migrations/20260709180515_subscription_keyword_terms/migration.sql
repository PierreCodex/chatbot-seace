-- F2 (docs/22): tema de la alerta — sinónimos congelados al crearla.
-- El matcher (HitDetectionService) exige que la descripción del anuncio
-- contenga alguno de estos términos. Determinista: nunca LLM en el crawl.
--
-- NOTA: `prisma migrate dev` intentó además "corregir" drift conocido
-- (índices *_trgm creados a mano y searches.filters_hash GENERATED — ver
-- migración 20260525214220). Esas líneas se eliminaron: NO deben tocarse.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "keyword_terms" TEXT[] DEFAULT ARRAY[]::TEXT[];
