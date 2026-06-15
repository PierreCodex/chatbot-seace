import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MainMenuFlow } from '../../../src/modules/bot/flows/main-menu.flow';
import type { FlowContext } from '../../../src/modules/bot/types';

function makeCtx(input: string): FlowContext {
  return {
    userId: 'u1',
    phoneNumber: '+51999',
    phoneNumberId: 'pn1',
    input,
    state: {
      userId: 'u1',
      phoneNumber: '+51999',
      phoneNumberId: 'pn1',
      flowId: 'main-menu',
      step: 'awaiting-selection',
      data: {},
      updatedAt: 0,
    },
  };
}

const menuMsg = { kind: 'list' } as never;
const presenter = { build: vi.fn().mockReturnValue(menuMsg) };
const anuncios = { id: 'search-anuncios', start: vi.fn().mockReturnValue({ messages: ['ACF'] }) };
const entity = { id: 'entity-resolver', start: vi.fn().mockReturnValue({ messages: ['ENT'] }) };
const procesos = { id: 'search-procesos', start: vi.fn().mockReturnValue({ messages: ['PROC'] }) };
const subscribe = {
  id: 'subscribe',
  startCreate: vi.fn().mockResolvedValue({ messages: ['SUBC'] }),
  startManage: vi.fn().mockResolvedValue({ messages: ['SUBM'] }),
};
const acfPresenter = { pageMessage: vi.fn().mockReturnValue({ kind: 'buttons' }) };
const processes = { findById: vi.fn() };

describe('MainMenuFlow', () => {
  const flow = new MainMenuFlow(
    presenter as never,
    anuncios as never,
    entity as never,
    procesos as never,
    subscribe as never,
    acfPresenter as never,
    processes as never,
  );
  beforeEach(() => vi.clearAllMocks());

  it('enruta "anuncios" al flujo ACF', async () => {
    const r = await flow.handle(makeCtx('anuncios'));
    expect(anuncios.start).toHaveBeenCalledTimes(1);
    expect(r.messages).toEqual(['ACF']);
  });

  it('enruta "entity" al resolvedor de entidad standalone', async () => {
    const r = await flow.handle(makeCtx('entity'));
    expect(entity.start).toHaveBeenCalledTimes(1);
    expect(r.messages).toEqual(['ENT']);
  });

  it('enruta "acf:refine" (botón de resultados) al flujo ACF', async () => {
    await flow.handle(makeCtx('acf:refine'));
    expect(anuncios.start).toHaveBeenCalledTimes(1);
  });

  it('muestra el menú ante saludo o input desconocido', async () => {
    const r = await flow.handle(makeCtx('hola'));
    expect(presenter.build).toHaveBeenCalledTimes(1);
    expect(r.nextFlowId).toBe('main-menu');
  });

  it('ayuda responde texto + menú', async () => {
    const r = await flow.handle(makeCtx('help'));
    expect(r.messages).toHaveLength(2);
    expect(presenter.build).toHaveBeenCalled();
  });

  it('"acf:subscribe" entra al flujo de crear alerta', async () => {
    const r = await flow.handle(makeCtx('acf:subscribe'));
    expect(subscribe.startCreate).toHaveBeenCalledTimes(1);
    expect(r.messages).toEqual(['SUBC']);
  });

  it('"subscriptions" entra a Mis alertas', async () => {
    const r = await flow.handle(makeCtx('subscriptions'));
    expect(subscribe.startManage).toHaveBeenCalledTimes(1);
    expect(r.messages).toEqual(['SUBM']);
  });

  it('"acfpage:N" renderiza esa página del resultado (edit)', async () => {
    processes.findById.mockResolvedValue({ id: 'p2', tab: 'anuncios_futuros' });
    const ctx = makeCtx('acfpage:1');
    ctx.state.data = { acfResults: { ids: ['p1', 'p2', 'p3'], total: 3, pdfUrl: null } };
    const r = await flow.handle(ctx);
    expect(processes.findById).toHaveBeenCalledWith('p2');
    expect(acfPresenter.pageMessage).toHaveBeenCalledTimes(1);
    expect(r.navigation).toBe('edit');
  });

  it('"acfpage" sin estado no rompe (muestra menú)', async () => {
    await flow.handle(makeCtx('acfpage:2'));
    expect(processes.findById).not.toHaveBeenCalled();
    expect(presenter.build).toHaveBeenCalled();
  });
});
