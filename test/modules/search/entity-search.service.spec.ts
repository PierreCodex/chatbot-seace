import { describe, expect, it, vi } from 'vitest';
import { EntitySearchService } from '../../../src/modules/search/entity-search.service';
import type { CachePort } from '../../../src/ports/cache.port';
import type { EntityLookupMatch, EntityLookupPort } from '../../../src/ports/entity-lookup.port';
import type { EntitiesRepoPort } from '../../../src/ports/persistence/entities.repo.port';

function fakeCache(): CachePort {
  const store = new Map<string, unknown>();
  return {
    get: async (k) => (store.get(k) ?? null) as never,
    set: async (k, v) => void store.set(k, v),
    del: async (k) => void store.delete(k),
    ping: async () => {},
  };
}

function m(nombre: string, ruc: string): EntityLookupMatch {
  return { ruc, nombre, tipoDoc: 'RUC' };
}

function makeService(live: EntityLookupMatch[], local: EntityLookupMatch[] = []) {
  const lookup = {
    searchByNombre: vi.fn().mockResolvedValue(live),
  } as unknown as EntityLookupPort;
  const entities = {
    searchByText: vi.fn().mockResolvedValue(local),
    findByRuc: vi.fn().mockResolvedValue(null),
    upsertManyByRuc: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
  } as unknown as EntitiesRepoPort;
  return new EntitySearchService(fakeCache(), entities, lookup);
}

describe('EntitySearchService · relevancia', () => {
  it('nombre completo exacto → colapsa a esa sola entidad (ficha directa)', async () => {
    const svc = makeService([
      m('MUNICIPALIDAD DISTRITAL DE CUSCA', '20100000001'),
      m('MUNICIPALIDAD DISTRITAL DE ATE', '20100000002'),
      m('MUNICIPALIDAD DISTRITAL DE LIMA', '20100000003'),
    ]);
    const res = await svc.search('Municipalidad Distrital de Cusca');
    expect(res).toHaveLength(1);
    expect(res[0].ruc).toBe('20100000001');
  });

  it('sin match exacto → deja lo relevante y descarta el ruido trigram', async () => {
    const svc = makeService([
      m('MUNICIPALIDAD PROVINCIAL DE ANTA', '20100000010'),
      m('MUNICIPALIDAD DISTRITAL DE CUSCA', '20100000011'),
    ]);
    const res = await svc.search('cusca');
    expect(res[0].ruc).toBe('20100000011'); // la que contiene "cusca"
    expect(res).toHaveLength(1); // "anta" (solo parecido trigram) se descarta
  });

  it('término específico descarta homónimos sin la palabra clave (caso "frontera")', async () => {
    const svc = makeService([
      m('UNIVERSIDAD NACIONAL DE FRONTERA - SULLANA', '20600000001'),
      m('UNIVERSIDAD NACIONAL DE PIURA', '20600000002'),
      m('UNIVERSIDAD NACIONAL DE TUMBES', '20600000003'),
    ]);
    const res = await svc.search('universidad nacional de frontera');
    expect(res).toHaveLength(1);
    expect(res[0].ruc).toBe('20600000001');
  });

  it('typo (sin ninguna coincidencia real) → conserva el fallback trigram', async () => {
    const svc = makeService([
      m('MUNICIPALIDAD DISTRITAL DE CUSCA', '20100000020'),
      m('MUNICIPALIDAD DISTRITAL DE ATE', '20100000021'),
    ]);
    const res = await svc.search('cuzca'); // con z: nadie lo contiene → todo trigram
    expect(res).toHaveLength(2);
  });
});
