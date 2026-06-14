import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SeaceNetworkError,
  SeaceTimeoutError,
  seaceFetch,
} from '../../../src/adapters/scraper/seace/http.util';

afterEach(() => vi.unstubAllGlobals());

function timeoutErr(): Error {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
}

describe('seaceFetch', () => {
  it('devuelve la respuesta cuando fetch resuelve', async () => {
    const res = { ok: true } as Response;
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', fetchMock);
    await expect(seaceFetch('http://x', {}, { retries: 0 })).resolves.toBe(res);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('lanza SeaceTimeoutError cuando agota los intentos por timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr()));
    await expect(seaceFetch('http://x', {}, { retries: 0 })).rejects.toBeInstanceOf(
      SeaceTimeoutError,
    );
  });

  it('reintenta una vez y luego resuelve', async () => {
    const res = { ok: true } as Response;
    const fetchMock = vi.fn().mockRejectedValueOnce(timeoutErr()).mockResolvedValue(res);
    vi.stubGlobal('fetch', fetchMock);
    await expect(seaceFetch('http://x', {}, { retries: 1 })).resolves.toBe(res);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('errores de red → SeaceNetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(seaceFetch('http://x', {}, { retries: 0 })).rejects.toBeInstanceOf(
      SeaceNetworkError,
    );
  });
});
