import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { ADMIN_REPO, type AdminRepoPort } from '../../ports/persistence/admin.repo.port';

export type AdminRole = 'owner' | 'seller';

/**
 * Resuelve el rol de permiso de un id de Telegram. El `owner` vive en `.env`
 * (`OWNER_IDS`, raíz de confianza inmutable); el `seller` en BD. Ver docs/17 §1, §5.
 */
@Injectable()
export class RolesService {
  private readonly owners: ReadonlySet<string>;

  constructor(
    @Inject(ADMIN_REPO) private readonly repo: AdminRepoPort,
    config: ConfigService<Env, true>,
  ) {
    this.owners = new Set(config.get('OWNER_IDS', { infer: true }));
  }

  isOwner(telegramId: string): boolean {
    return this.owners.has(telegramId);
  }

  async isSeller(telegramId: string): Promise<boolean> {
    if (this.isOwner(telegramId)) return false; // un owner no es "seller"
    return (await this.repo.findActiveSeller(telegramId)) !== null;
  }

  /** `owner` › `seller` › `null` (sin permiso administrativo). */
  async roleOf(telegramId: string): Promise<AdminRole | null> {
    if (this.isOwner(telegramId)) return 'owner';
    return (await this.repo.findActiveSeller(telegramId)) ? 'seller' : null;
  }

  /** owner y seller tienen Premium **por su rol** (no necesitan plan). docs/17 §1. */
  async isPremiumByRole(telegramId: string): Promise<boolean> {
    return (await this.roleOf(telegramId)) !== null;
  }
}
