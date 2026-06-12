import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityResolverFlow } from '../../../src/modules/bot/flows/entity-resolver.flow';
import type { FlowContext } from '../../../src/modules/bot/types';

const entitySearch = { search: vi.fn() };
const presenter = {
  card: vi.fn().mockReturnValue({ kind: 'buttons' }),
  disambiguation: vi.fn().mockReturnValue({ kind: 'list' }),
};
const anunciosFlow = { startWithEntity: vi.fn().mockReturnValue({ messages: ['OBJ'] }) };

function makeFlow(): EntityResolverFlow {
  return new EntityResolverFlow(entitySearch as never, presenter as never, anunciosFlow as never);
}

function ctx(step: string, input: string, data: Record<string, unknown> = {}): FlowContext {
  return {
    userId: 'u1',
    phoneNumber: '+51999',
    phoneNumberId: 'pn1',
    input,
    notify: async () => {},
    state: {
      userId: 'u1',
      phoneNumber: '+51999',
      phoneNumberId: 'pn1',
      flowId: 'entity-resolver',
      step,
      data,
      updatedAt: 0,
    },
  };
}

describe('EntityResolverFlow (UX-3 standalone)', () => {
  let flow: EntityResolverFlow;
  beforeEach(() => {
    vi.clearAllMocks();
    flow = makeFlow();
  });

  it('start() pide el texto y deja awaiting-query', async () => {
    const r = await flow.handle(ctx('initial', 'x'));
    expect(r.messages[0].kind).toBe('text');
    expect(r.nextFlowId).toBe('entity-resolver');
    expect(r.nextStep).toBe('awaiting-query');
  });

  it('query < 2 letras vuelve a pedir (sin buscar)', async () => {
    const r = await flow.handle(ctx('awaiting-query', 'a'));
    expect(entitySearch.search).not.toHaveBeenCalled();
    expect(r.messages[0].kind).toBe('text');
  });

  it('0 coincidencias responde texto + botones de cierre', async () => {
    entitySearch.search.mockResolvedValue([]);
    const r = await flow.handle(ctx('awaiting-query', 'zzz'));
    expect(r.messages[0].kind).toBe('text');
    const last = r.messages[1];
    expect(last.kind).toBe('buttons');
    if (last.kind === 'buttons') {
      expect(last.buttons.map((b) => b.id)).toEqual(['entact:otra', 'menu:main']);
    }
    expect(r.nextStep).toBe('awaiting-query');
  });

  it('"🔎 Otra entidad" (entact:otra) re-pide el texto sin buscar', async () => {
    const r = await flow.handle(ctx('viewing', 'entact:otra', { entity: { ruc: '1', nombre: 'X' } }));
    expect(entitySearch.search).not.toHaveBeenCalled();
    expect(r.messages[0].kind).toBe('text');
    expect(r.nextStep).toBe('awaiting-query');
  });

  it('escribir otra entidad en viewing dispara una nueva búsqueda', async () => {
    entitySearch.search.mockResolvedValue([{ ruc: '9', nombre: 'MUNI SULLANA', tipoDoc: 'RUC' }]);
    const r = await flow.handle(ctx('viewing', 'muni sullana', { entity: { ruc: '1', nombre: 'X' } }));
    expect(entitySearch.search).toHaveBeenCalledWith('muni sullana');
    expect(r.nextStep).toBe('viewing');
  });

  it('1 coincidencia muestra la ficha y deja viewing', async () => {
    const only = { ruc: '20154265061', nombre: 'GORE PIURA', tipoDoc: 'RUC' };
    entitySearch.search.mockResolvedValue([only]);
    const r = await flow.handle(ctx('awaiting-query', 'gore piura'));
    expect(presenter.card).toHaveBeenCalledWith(expect.anything(), only);
    expect(r.nextStep).toBe('viewing');
    expect(r.dataPatch).toMatchObject({ entity: only });
  });

  it('varias coincidencias → lista de desambiguación', async () => {
    const top = [
      { ruc: '1', nombre: 'GORE PIURA', tipoDoc: 'RUC' },
      { ruc: '2', nombre: 'MUNI PIURA', tipoDoc: 'RUC' },
    ];
    entitySearch.search.mockResolvedValue(top);
    const r = await flow.handle(ctx('awaiting-query', 'piura'));
    expect(presenter.disambiguation).toHaveBeenCalled();
    expect(r.nextStep).toBe('disambiguation');
    expect(r.dataPatch?.entityCandidates).toHaveLength(2);
  });

  it('elegir de la lista muestra la ficha', async () => {
    const cands = [
      { ruc: '1', nombre: 'GORE PIURA', tipoDoc: 'RUC' },
      { ruc: '2', nombre: 'MUNI PIURA', tipoDoc: 'RUC' },
    ];
    const r = await flow.handle(ctx('disambiguation', 'entity:2', { entityCandidates: cands }));
    expect(presenter.card).toHaveBeenCalledWith(expect.anything(), cands[1]);
    expect(r.nextStep).toBe('viewing');
    expect(r.dataPatch).toMatchObject({ entity: cands[1] });
  });

  it('"Ver anuncios" hace handoff al flujo ACF con la entidad fijada', async () => {
    const entity = { ruc: '20154265061', nombre: 'GORE PIURA', tipoDoc: 'RUC' };
    const r = await flow.handle(ctx('viewing', 'entact:anuncios', { entity }));
    expect(anunciosFlow.startWithEntity).toHaveBeenCalledWith(expect.anything(), {
      ruc: '20154265061',
      nombre: 'GORE PIURA',
    });
    expect(r.messages).toEqual(['OBJ']);
  });

  it('"Crear alerta" responde placeholder + reitera la ficha', async () => {
    const entity = { ruc: '1', nombre: 'GORE PIURA', tipoDoc: 'RUC' };
    const r = await flow.handle(ctx('viewing', 'entact:alerta', { entity }));
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0].kind).toBe('text');
    expect(anunciosFlow.startWithEntity).not.toHaveBeenCalled();
  });
});
