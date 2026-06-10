/**
 * Extrae los parámetros JSON-like que PrimeFaces inyecta en `onclick`:
 *
 *   PrimeFaces.addSubmitParam(
 *     'tbBuscador:idFormBuscarProceso',
 *     {'nidConvocatoria':'WKi7+...','nidProceso':'1016256','nidSistema':'3','ntipo':'1'}
 *   ).submit('tbBuscador:idFormBuscarProceso');
 *
 * Retorna { nidConvocatoria, nidProceso, nidSistema, ntipo } o {} si no matchea.
 *
 * Notas:
 *   - PrimeFaces usa comillas simples; las convertimos a dobles antes de JSON.parse.
 *   - Los valores pueden tener `+`, `/`, `=` (Base64) y deben preservarse tal cual.
 */
export function parsePrimeFacesParams(onclick: string): Record<string, string> {
  if (!onclick) return {};
  const match = onclick.match(/addSubmitParam\([^,]+,\s*(\{[^}]+\})/);
  if (!match) return {};
  const raw = match[1].replace(/'/g, '"');
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Convierte `"S/. 1,234,567.89"` o `"1234567.89"` en string decimal limpio,
 * preservando precisión arbitraria (Decimal en Prisma). Devuelve null si no
 * hay número parseable.
 */
export function normalizeMoneyAmount(input: string | null | undefined): string | null {
  if (!input) return null;
  // 1) Recorta cualquier prefijo no-numérico (ej. "S/.", "USD ").
  // 2) Recorta cualquier sufijo no-numérico residual.
  const trimmed = input.replace(/^[^\d-]+/, '').replace(/[^\d.,]+$/, '');
  const cleaned = trimmed.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return null;
  // "1,234,567.89" → "1234567.89" ; "1.234.567,89" → "1234567.89"
  let normalized: string;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Asume separador decimal = el último símbolo
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Solo coma: si hay 3 dígitos después, es miles
    const after = cleaned.split(',').pop()!;
    normalized = after.length === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return normalized;
}

/**
 * Parsea "dd/MM/yyyy [HH:mm[:ss]]" típico de SEACE a Date UTC (asumimos zona Lima).
 */
export function parseSeaceDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, hh = '0', mm = '0', ss = '0'] = m;
  // SEACE muestra hora Lima (UTC-5, sin DST). Convertimos a UTC sumando 5h.
  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh + 5, +mm, +ss);
  return new Date(utcMs);
}
