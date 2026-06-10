-- Dedup de filas ACF (sin nomenclatura) por content_hash.
-- Indice UNICO PARCIAL: una sola fila por (tab, content_hash) en anuncios_futuros.
-- Tambien acelera el findFirst del upsert para esa pestana.
-- Ver docs/02-arquitectura.md (D6) y docs/07-arquitectura-backend.md (3.5).
CREATE UNIQUE INDEX IF NOT EXISTS "processes_acf_tab_content_hash_key"
  ON "processes" ("tab", "content_hash")
  WHERE "tab" = 'anuncios_futuros';
