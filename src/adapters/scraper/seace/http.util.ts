/**
 * Helpers HTTP para los scrapers de SEACE por fetch. El objetivo es que **ninguna
 * petición se cuelgue para siempre**: si SEACE no responde, abortamos por timeout
 * y lanzamos un error TIPADO para que las capas de arriba (bot/listener) den un
 * mensaje humano en vez de dejar al usuario en silencio.
 */

const DEFAULT_TIMEOUT_MS = 12_000; // SEACE suele responder en 1-2s; 12s es holgado
const DEFAULT_RETRIES = 1; // 1 reintento ante timeout/red (cubre el bache puntual)
const RETRY_DELAY_MS = 400;

/** SEACE no respondió dentro del timeout (la petición se abortó). */
export class SeaceTimeoutError extends Error {
  constructor(message = 'SEACE no respondió a tiempo') {
    super(message);
    this.name = 'SeaceTimeoutError';
  }
}

/** Fallo de red al hablar con SEACE (DNS, conexión rechazada, etc.). */
export class SeaceNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeaceNetworkError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` contra SEACE con **timeout duro** (`AbortSignal.timeout`) + reintento
 * ante timeout/red. Devuelve la `Response` tal cual (el caller lee `.text()` y
 * valida el contenido, p.ej. `ViewExpiredException`). Lanza `SeaceTimeoutError`
 * o `SeaceNetworkError` si agota los intentos.
 */
export async function seaceFetch(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(RETRY_DELAY_MS);
    }
  }

  const name = (lastErr as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    throw new SeaceTimeoutError();
  }
  throw new SeaceNetworkError((lastErr as Error)?.message ?? 'fallo de red con SEACE');
}
