import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesService } from '../../../src/modules/admin/roles.service';

const repo = { findActiveSeller: vi.fn() };
const config = { get: () => ['1', '2'] }; // OWNER_IDS

function make(): RolesService {
  return new RolesService(repo as never, config as never);
}

describe('RolesService', () => {
  let svc: RolesService;
  beforeEach(() => {
    vi.clearAllMocks();
    svc = make();
  });

  it('isOwner reconoce los ids de OWNER_IDS', () => {
    expect(svc.isOwner('1')).toBe(true);
    expect(svc.isOwner('99')).toBe(false);
  });

  it('roleOf → owner sin consultar la BD', async () => {
    expect(await svc.roleOf('1')).toBe('owner');
    expect(repo.findActiveSeller).not.toHaveBeenCalled();
  });

  it('roleOf → seller si hay fila activa', async () => {
    repo.findActiveSeller.mockResolvedValue({ telegramId: '50', active: true });
    expect(await svc.roleOf('50')).toBe('seller');
  });

  it('roleOf → null si no es owner ni seller', async () => {
    repo.findActiveSeller.mockResolvedValue(null);
    expect(await svc.roleOf('77')).toBeNull();
  });

  it('un owner no cuenta como seller', async () => {
    expect(await svc.isSeller('1')).toBe(false);
    expect(repo.findActiveSeller).not.toHaveBeenCalled();
  });
});
