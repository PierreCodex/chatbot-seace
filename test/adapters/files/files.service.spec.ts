import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AcfPdfRenderer } from '../../../src/adapters/files/acf-pdf.renderer';
import { EntitiesPdfRenderer } from '../../../src/adapters/files/entities-pdf.renderer';
import { FilesService } from '../../../src/adapters/files/files.service';
import type { Env } from '../../../src/config/env.schema';
import type { CachePort } from '../../../src/ports/cache.port';
import type { StoredProcess } from '../../../src/ports/persistence/processes.repo.port';

function fakeCache(): { cache: CachePort; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const cache: CachePort = {
    get: async (k) => (store.get(k) ?? null) as never,
    set: async (k, v) => {
      store.set(k, v);
    },
    del: async (k) => {
      store.delete(k);
    },
    ping: async () => {},
  };
  return { cache, store };
}

function fakeConfig(publicBaseUrl?: string): ConfigService<Env, true> {
  return { get: () => publicBaseUrl } as unknown as ConfigService<Env, true>;
}
const proc = {
  entityNombre: 'MUNICIPALIDAD X',
  fechaPublicacion: null,
  objeto: 'obra',
  descripcion: 'd',
  acf: null,
  procedimiento: null,
} as unknown as StoredProcess;

describe('FilesService', () => {
  it('hospeda el PDF, devuelve una URL servible y getPdf recupera el binario', async () => {
    const { cache } = fakeCache();
    const svc = new FilesService(
      cache,
      new AcfPdfRenderer(),
      new EntitiesPdfRenderer(),
      fakeConfig('https://x.test/'),
    );

    const url = await svc.hostAcfPdf([proc]);
    expect(url).toMatch(/^https:\/\/x\.test\/files\/[0-9a-f-]+\.pdf$/);

    const token = (url as string).split('/').pop()!.replace('.pdf', '');
    const pdf = await svc.getPdf(token);
    expect(pdf).not.toBeNull();
    expect((pdf as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('devuelve null si no hay PUBLIC_BASE_URL (degrada a tarjetas)', async () => {
    const { cache } = fakeCache();
    const svc = new FilesService(
      cache,
      new AcfPdfRenderer(),
      new EntitiesPdfRenderer(),
      fakeConfig(undefined),
    );
    expect(await svc.hostAcfPdf([proc])).toBeNull();
  });

  it('devuelve null si no hay procesos', async () => {
    const { cache } = fakeCache();
    const svc = new FilesService(
      cache,
      new AcfPdfRenderer(),
      new EntitiesPdfRenderer(),
      fakeConfig('https://x.test'),
    );
    expect(await svc.hostAcfPdf([])).toBeNull();
  });

  it('getPdf devuelve null para un token inexistente', async () => {
    const { cache } = fakeCache();
    const svc = new FilesService(
      cache,
      new AcfPdfRenderer(),
      new EntitiesPdfRenderer(),
      fakeConfig('https://x.test'),
    );
    expect(await svc.getPdf('no-existe')).toBeNull();
  });

  it('hostEntitiesPdf renderiza el listado, devuelve URL y getPdf recupera el binario', async () => {
    const { cache } = fakeCache();
    const svc = new FilesService(
      cache,
      new AcfPdfRenderer(),
      new EntitiesPdfRenderer(),
      fakeConfig('https://x.test'),
    );
    const url = await svc.hostEntitiesPdf([
      { ruc: '20154265061', nombre: 'GORE PIURA', tipoDoc: 'RUC' },
      { ruc: '20131312955', nombre: 'MINISTERIO DE SALUD', tipoDoc: null },
    ]);
    expect(url).toMatch(/^https:\/\/x\.test\/files\/[0-9a-f-]+\.pdf$/);
    const token = (url as string).split('/').pop()!.replace('.pdf', '');
    const pdf = await svc.getPdf(token);
    expect((pdf as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
