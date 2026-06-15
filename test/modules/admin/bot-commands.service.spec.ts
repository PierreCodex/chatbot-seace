import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotCommandsService } from '../../../src/modules/admin/bot-commands.service';

const messaging = { setMyCommands: vi.fn() };
const admin = { listSellers: vi.fn() };
const roles = { roleOf: vi.fn() };
const config = { get: () => ['1'] }; // OWNER_IDS

function make(): BotCommandsService {
  return new BotCommandsService(
    messaging as never,
    admin as never,
    roles as never,
    config as never,
  );
}

function cmdsOf(call: unknown[]): string[] {
  return (call[0] as { command: string }[]).map((c) => c.command);
}

describe('BotCommandsService', () => {
  let svc: BotCommandsService;
  beforeEach(() => {
    vi.clearAllMocks();
    messaging.setMyCommands.mockResolvedValue(undefined);
    admin.listSellers.mockResolvedValue([{ telegramId: '500' }]);
    svc = make();
  });

  it('syncAll: público (default) + owner + seller, cada uno con su menú', async () => {
    await svc.syncAll();
    const calls = messaging.setMyCommands.mock.calls;
    // default = público (sin comandos admin)
    const def = calls.find((c) => (c[1] as { type: string }).type === 'default')!;
    expect(cmdsOf(def)).not.toContain('activar');
    expect(cmdsOf(def)).toContain('miplan');
    // owner chat = todo (incluye owner-only)
    const owner = calls.find((c) => (c[1] as { chatId?: string }).chatId === '1')!;
    expect(cmdsOf(owner)).toContain('agregarvendedor');
    // seller chat = planes pero NO owner-only
    const seller = calls.find((c) => (c[1] as { chatId?: string }).chatId === '500')!;
    expect(cmdsOf(seller)).toContain('activar');
    expect(cmdsOf(seller)).not.toContain('agregarvendedor');
  });

  it('syncUser usa el menú según el rol', async () => {
    roles.roleOf.mockResolvedValueOnce('owner');
    await svc.syncUser('1');
    expect(cmdsOf(messaging.setMyCommands.mock.calls[0])).toContain('agregarvendedor');

    roles.roleOf.mockResolvedValueOnce(null);
    await svc.syncUser('999');
    const last = messaging.setMyCommands.mock.calls.at(-1)!;
    expect(cmdsOf(last)).not.toContain('activar'); // usuario común → solo público
    expect((last[1] as { chatId?: string }).chatId).toBe('999');
  });

  it('si el canal no soporta setMyCommands, no hace nada', async () => {
    const svc2 = new BotCommandsService(
      {} as never,
      admin as never,
      roles as never,
      config as never,
    );
    await svc2.syncAll();
    expect(messaging.setMyCommands).not.toHaveBeenCalled();
  });
});
