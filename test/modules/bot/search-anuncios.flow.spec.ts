import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchAnunciosFlow } from '../../../src/modules/bot/flows/search-anuncios.flow';
import type { FlowContext } from '../../../src/modules/bot/types';

const entitySearch = { search: vi.fn() };
const facade = { search: vi.fn() };
const presenter = { build: vi.fn() };

function makeFlow(): SearchAnunciosFlow {
  const files = { hostAcfPdf: vi.fn(), hostEntitiesPdf: vi.fn(), getPdf: vi.fn() };
  const config = { get: () => 'whatsapp' };
  // Registry sin flow 'nlu' registrado → la segunda oportunidad NLU no aplica.
  const registry = { get: vi.fn() };
  return new SearchAnunciosFlow(
    entitySearch as never,
    facade as never,
    presenter as never,
    registry as never,
    files as never,
    config as never,
  );
}

function ctx(step: string, input: string, data: Record<string, unknown> = {}): FlowContext {
  return {
    userId: 'u1',
    phoneNumber: '+51999',
    phoneNumberId: 'pn1',
    input,
    notify: async () => ({ messageId: 's1' }),
    state: {
      userId: 'u1',
      phoneNumber: '+51999',
      phoneNumberId: 'pn1',
      flowId: 'search-anuncios',
      step,
      data,
      updatedAt: 0,
    },
  };
}

describe('SearchAnunciosFlow (ACF, variante A + empujón suave)', () => {
  let flow: SearchAnunciosFlow;
  beforeEach(() => {
    vi.clearAllMocks();
    flow = makeFlow();
  });

  it('start() pide el objeto (lista de 4) y deja awaiting-objeto', async () => {
    const r = await flow.handle(ctx('initial', 'x'));
    const m = r.messages[0];
    expect(m.kind).toBe('list');
    if (m.kind === 'list') {
      expect(m.sections[0].rows.map((x) => x.id)).toEqual([
        'objeto:obra',
        'objeto:bien',
        'objeto:servicio',
        'objeto:consultoria_obra',
      ]);
    }
    expect(r.nextStep).toBe('awaiting-objeto');
  });

  it('objeto inválido lo vuelve a pedir (obligatorio)', async () => {
    const r = await flow.handle(ctx('awaiting-objeto', 'basura'));
    expect(r.messages).toHaveLength(2);
    expect(r.nextStep).toBeUndefined();
  });

  it('elegir objeto muestra el menú dinámico con resumen', async () => {
    const r = await flow.handle(ctx('awaiting-objeto', 'objeto:obra'));
    expect(r.nextStep).toBe('menu');
    expect(r.dataPatch).toMatchObject({ objeto: 'obra' });
    const m = r.messages[0];
    if (m.kind === 'list') {
      const ids = m.sections[0].rows.map((x) => x.id);
      expect(ids).toContain('acf:buscar');
      expect(ids).toContain('acf:entidad');
    }
  });

  it('Buscar ahora SIN entidad ejecuta A2 (objeto-only) directo, sin confirmación', async () => {
    facade.search.mockResolvedValue({ source: 'queued', jobId: 'j1' });
    const r = await flow.handle(ctx('menu', 'acf:buscar', { objeto: 'obra' }));
    expect(facade.search).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'anuncios_futuros', filters: { objeto: 'obra' } }),
    );
    expect(r.nextFlowId).toBe('main-menu');
    expect(r.messages[0].kind).toBe('text');
  });

  it('menú → "Filtrar entidad" pide el texto de la entidad', async () => {
    const r = await flow.handle(ctx('menu', 'acf:entidad', { objeto: 'obra' }));
    expect(r.nextStep).toBe('awaiting-entity');
  });

  it('varias coincidencias de entidad → lista de desambiguación', async () => {
    entitySearch.search.mockResolvedValue([
      { ruc: '1', nombre: 'GORE PIURA' },
      { ruc: '2', nombre: 'MUNI PIURA' },
    ]);
    const r = await flow.handle(ctx('awaiting-entity', 'piura', { objeto: 'obra' }));
    expect(r.nextStep).toBe('entity-disambiguation');
    expect(r.dataPatch?.entityCandidates).toHaveLength(2);
  });

  it('un solo match de entidad vuelve al menú con la entidad fijada (A1)', async () => {
    entitySearch.search.mockResolvedValue([{ ruc: '20154265061', nombre: 'GORE PIURA' }]);
    const r = await flow.handle(ctx('awaiting-entity', 'gore piura', { objeto: 'obra' }));
    expect(r.nextStep).toBe('menu');
    expect(r.dataPatch).toMatchObject({ entity: { ruc: '20154265061', nombre: 'GORE PIURA' } });
  });

  it('Buscar ahora CON entidad ejecuta A1 y presenta resultados cacheados', async () => {
    facade.search.mockResolvedValue({ source: 'cached_db', totalFound: 2, processes: [{}, {}] });
    presenter.build.mockReturnValue([{ kind: 'text' }]);
    const r = await flow.handle(
      ctx('menu', 'acf:buscar', {
        objeto: 'obra',
        entity: { ruc: '20154265061', nombre: 'GORE PIURA' },
      }),
    );
    expect(facade.search).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'anuncios_futuros',
        filters: { objeto: 'obra', entityNombre: 'GORE PIURA' },
      }),
    );
    expect(presenter.build).toHaveBeenCalledTimes(1);
    expect(r.messages).toEqual([{ kind: 'text' }]);
    expect(r.nextFlowId).toBe('main-menu');
  });

  it('0 resultados (inline) → botones de salida y NO sale del flujo', async () => {
    facade.search.mockResolvedValue({ source: 'cached_db', totalFound: 0, processes: [] });
    const r = await flow.handle(
      ctx('menu', 'acf:buscar', {
        objeto: 'obra',
        entity: { ruc: '20154265061', nombre: 'GORE PIURA' },
      }),
    );
    expect(presenter.build).not.toHaveBeenCalled(); // el flujo arma el mensaje, no el presenter
    expect(r.nextFlowId).toBeUndefined(); // sigue en search-anuncios
    expect(r.nextStep).toBe('menu');
    const m = r.messages[0];
    expect(m.kind).toBe('buttons');
    if (m.kind === 'buttons') {
      expect(m.buttons.map((b) => b.id)).toEqual(['acf:objeto', 'acf:entidad', 'menu:main']);
    }
  });

  it('"Otro objeto" re-pide el objeto conservando la entidad', async () => {
    const r = await flow.handle(
      ctx('menu', 'acf:objeto', { objeto: 'obra', entity: { ruc: '1', nombre: 'X' } }),
    );
    expect(r.nextStep).toBe('awaiting-objeto');
    expect(r.dataPatch).toMatchObject({ objeto: undefined });
    expect(r.messages[0].kind).toBe('list');
  });

  it('si la búsqueda falla por timeout, responde mensaje humano y vuelve al menú', async () => {
    const err = new Error('SEACE no respondió a tiempo');
    err.name = 'SeaceTimeoutError';
    facade.search.mockRejectedValue(err);
    const r = await flow.handle(
      ctx('menu', 'acf:buscar', { objeto: 'obra', entity: { ruc: '1', nombre: 'X' } }),
    );
    expect(r.nextFlowId).toBe('main-menu');
    const m = r.messages[0];
    expect(m.kind).toBe('text');
    if (m.kind === 'text') expect(m.body).toMatch(/tardando/i);
  });

  it('"Quitar entidad" vuelve al menú en modo A2', async () => {
    const r = await flow.handle(
      ctx('menu', 'acf:quitar', { objeto: 'obra', entity: { ruc: '1', nombre: 'X' } }),
    );
    expect(r.nextStep).toBe('menu');
    expect(r.dataPatch).toMatchObject({ entity: undefined });
  });
});
