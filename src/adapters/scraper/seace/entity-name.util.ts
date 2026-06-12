/**
 * Comparación de nombres de entidad para ACF. SEACE **no** permite filtrar los
 * Anuncios de Contratación Futura por entidad server-side desde el form de
 * búsqueda (solo por objeto), así que el filtro por entidad se aplica en cliente
 * sobre las filas raspadas. Tanto el nombre del anuncio como el de la tabla
 * `entities` provienen de SEACE, pero pueden diferir en tildes/espacios → se
 * normaliza antes de comparar (mayúsculas, sin diacríticos, espacios colapsados).
 */
export function normalizeEntityName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Dos nombres de entidad refieren a la misma entidad? (normalizado, igualdad). */
export function sameEntityName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  return na.length > 0 && na === nb;
}
