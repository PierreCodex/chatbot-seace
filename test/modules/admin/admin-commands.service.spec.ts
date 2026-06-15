import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminCommandsService,
  parseCommand,
} from '../../../src/modules/admin/admin-commands.service';
import { PlanService } from '../../../src/modules/admin/plan.service';
import { RolesService } from '../../../src/modules/admin/roles.service';

const repo = {
  findActiveSeller: vi.fn(),
  listSellers: vi.fn(),
  addSeller: vi.fn(),
  revokeSeller: vi.fn(),
  findUser: vi.fn(),
  setPlan: vi.fn(),
  setBlocked: vi.fn(),
  listActivePremium: vi.fn(),
  listExpiringSoon: vi.fn(),
  expireOverdue: vi.fn(),
  log: vi.fn(),
  listAuditByTarget: vi.fn(),
  listAuditByActor: vi.fn(),
  listAuditRecent: vi.fn(),
};
const cache = { get: vi.fn(), set: vi.fn(), del: vi.fn(), ping: vi.fn() };
const config = { get: () => ['1'] }; // OWNER_IDS = ['1']

const botCommands = { syncUser: vi.fn().mockResolvedValue(undefined) };

function make(): AdminCommandsService {
  const roles = new RolesService(repo as never, config as never);
  return new AdminCommandsService(
    roles,
    new PlanService(),
    botCommands as never,
    repo as never,
    cache as never,
  );
}

function freeUser(id: string) {
  return {
    id: `uuid-${id}`,
    channelUserId: id,
    plan: 'free',
    planExpiresAt: null,
    blocked: false,
    displayName: null,
  };
}

function ctx(input: string, senderId = '1') {
  return { senderId, phoneNumberId: 'pn1', input };
}

describe('parseCommand', () => {
  it('extrae cmd + args y normaliza @bot', () => {
    expect(parseCommand('/activar 123 30 pago yape')).toEqual({
      cmd: 'activar',
      args: ['123', '30', 'pago', 'yape'],
    });
    expect(parseCommand('/miplan@DataSeaceBot')).toEqual({ cmd: 'miplan', args: [] });
  });
  it('null si no empieza con /', () => {
    expect(parseCommand('hola')).toBeNull();
  });
});

describe('AdminCommandsService.handle', () => {
  let svc: AdminCommandsService;
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findActiveSeller.mockResolvedValue(null);
    repo.log.mockResolvedValue(undefined);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    svc = make();
  });

  it('input que no es comando → null (sigue el flujo normal)', async () => {
    expect(await svc.handle(ctx('hola'))).toBeNull();
    expect(await svc.handle(ctx('/start'))).toBeNull(); // /start no lo maneja admin
  });

  it('/miplan de un usuario común muestra Free', async () => {
    repo.findUser.mockResolvedValue(freeUser('999'));
    const r = await svc.handle(ctx('/miplan', '999'));
    expect(r).not.toBeNull();
    expect(r!.messages[0].kind).toBe('text');
    const body = (r!.messages[0] as { body: string }).body;
    expect(body).toContain('<code>999</code>');
    expect(body).toContain('Free');
  });

  it('/miplan del owner muestra Premium por rol (sin auto-activarse)', async () => {
    repo.findUser.mockResolvedValue(freeUser('1')); // plan Free en BD
    const r = await svc.handle(ctx('/miplan', '1'));
    const body = (r!.messages[0] as { body: string }).body;
    expect(body).toContain('Premium');
    expect(body).toMatch(/por tu rol/i);
  });

  it('/ayuda (público) explica las funciones del bot', async () => {
    const r = await svc.handle(ctx('/ayuda', '999'));
    const body = (r!.messages[0] as { body: string }).body;
    expect(body).toMatch(/anuncios futuros/i);
    expect(body).toContain('/ent');
    expect(body).toContain('/miplan');
  });

  it('/cmds del owner: vista inicial con las 4 categorías + Cerrar', async () => {
    const r = await svc.handle(ctx('/cmds', '1'));
    const m = r!.messages[0];
    expect(m.kind).toBe('buttons');
    if (m.kind === 'buttons') {
      expect((m as { body: string }).body).toMatch(/categoría/i);
      const ids = m.buttons.map((b) => b.id);
      expect(ids).toEqual([
        'cmds:c:planes:0',
        'cmds:c:consultas:0',
        'cmds:c:sellers:0',
        'cmds:c:moderacion:0',
        'cmds:exit',
      ]);
    }
  });

  it('owner abre la categoría Sellers (cards) editando in-place', async () => {
    const r = await svc.handle(ctx('cmds:c:sellers:0', '1'));
    expect(r!.navigation).toBe('edit');
    const body = (r!.messages[0] as { body: string }).body;
    expect(body).toMatch(/Sellers/i);
    expect(body).toContain('/agregarvendedor');
  });

  it('categoría Consultas pagina (4 comandos → botón Siguiente)', async () => {
    const r = await svc.handle(ctx('cmds:c:consultas:0', '1'));
    const m = r!.messages[0];
    if (m.kind === 'buttons') {
      expect((m as { body: string }).body).toContain('1/2');
      expect(m.buttons.map((b) => b.id)).toContain('cmds:c:consultas:1');
    }
  });

  it('/cmds del seller solo ofrece 2 categorías (sin Sellers/Moderación)', async () => {
    repo.findActiveSeller.mockResolvedValue({ telegramId: '500', active: true });
    const r = await svc.handle(ctx('/cmds', '500'));
    const m = r!.messages[0];
    if (m.kind === 'buttons') {
      const ids = m.buttons.map((b) => b.id);
      expect(ids).toEqual(['cmds:c:planes:0', 'cmds:c:consultas:0', 'cmds:exit']);
    }
  });

  it('seller que fuerza una categoría owner-only cae a la vista inicial', async () => {
    repo.findActiveSeller.mockResolvedValue({ telegramId: '500', active: true });
    const r = await svc.handle(ctx('cmds:c:moderacion:0', '500'));
    const body = (r!.messages[0] as { body: string }).body;
    expect(body).toMatch(/categoría/i); // home, no la card de moderación
    expect(body).not.toContain('/panico');
  });

  it('cmds:home vuelve a la vista inicial (edit)', async () => {
    const r = await svc.handle(ctx('cmds:home', '1'));
    expect(r!.navigation).toBe('edit');
    expect((r!.messages[0] as { body: string }).body).toMatch(/categoría/i);
  });

  it('botón Cerrar (cmds:exit) borra el mensaje', async () => {
    const r = await svc.handle(ctx('cmds:exit', '1'));
    expect(r!.navigation).toBe('delete');
    expect(r!.messages).toEqual([]);
  });

  it('/cmds de un no-autorizado → sigilo ([])', async () => {
    const r = await svc.handle(ctx('/cmds', '999'));
    expect(r!.messages).toEqual([]);
  });

  it('no-autorizado tipea comando admin → sigilo ([]) + registra intento', async () => {
    const r = await svc.handle(ctx('/activar 555 30', '77'));
    expect(r!.messages).toEqual([]);
    expect(repo.setPlan).not.toHaveBeenCalled();
    expect(repo.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'intento_no_autorizado' }),
    );
  });

  it('owner /activar activa premium y notifica al destino', async () => {
    repo.findUser.mockResolvedValue(freeUser('555'));
    repo.setPlan.mockResolvedValue({
      channelUserId: '555',
      plan: 'premium',
      planExpiresAt: new Date('2026-07-14T00:00:00Z'),
      blocked: false,
    });
    const r = await svc.handle(ctx('/activar 555 30 pago'));
    expect(repo.setPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: '555',
        plan: 'premium',
        action: 'plan_activado',
        actorRole: 'owner',
      }),
    );
    expect(r!.messages).toHaveLength(2);
    expect(r!.messages[0].to).toBe('1'); // confirmación al owner
    expect(r!.messages[1].to).toBe('555'); // aviso al usuario
  });

  it('/activar a usuario inexistente avisa que no inició el bot', async () => {
    repo.findUser.mockResolvedValue(null);
    const r = await svc.handle(ctx('/activar 555 30'));
    expect(repo.setPlan).not.toHaveBeenCalled();
    expect((r!.messages[0] as { body: string }).body).toMatch(/no ha iniciado/i);
  });

  it('seller NO puede modificar su propio plan (anti-escalamiento)', async () => {
    repo.findActiveSeller.mockResolvedValue({ telegramId: '500', active: true });
    const r = await svc.handle(ctx('/activar 500 30', '500'));
    expect(repo.setPlan).not.toHaveBeenCalled();
    expect((r!.messages[0] as { body: string }).body).toMatch(/propio plan/i);
  });

  it('seller NO puede usar comandos solo-owner', async () => {
    repo.findActiveSeller.mockResolvedValue({ telegramId: '500', active: true });
    const r = await svc.handle(ctx('/vendedores', '500'));
    expect((r!.messages[0] as { body: string }).body).toMatch(/solo del dueño/i);
  });

  it('owner /agregarvendedor da de alta + avisa', async () => {
    repo.findUser.mockResolvedValue(freeUser('600'));
    repo.addSeller.mockResolvedValue({ telegramId: '600', active: true });
    const r = await svc.handle(ctx('/agregarvendedor 600 Juan'));
    expect(repo.addSeller).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: '600', ownerId: '1' }),
    );
    expect(r!.messages).toHaveLength(2);
  });
});
