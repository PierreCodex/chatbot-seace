import { Inject, Injectable, Logger } from '@nestjs/common';
import type { StoredWaUser } from '../../ports/persistence/wa-users.repo.port';
import { WA_USERS_REPO, type WaUsersRepoPort } from '../../ports/persistence/wa-users.repo.port';

@Injectable()
export class WaUsersService {
  private readonly logger = new Logger(WaUsersService.name);

  constructor(@Inject(WA_USERS_REPO) private readonly repo: WaUsersRepoPort) {}

  async upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser> {
    const user = await this.repo.upsertByPhone(phoneE164, displayName);
    this.logger.debug(`Upserted wa_user ${user.id} for ${phoneE164}`);
    return user;
  }
}
