import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UserChannel } from '@prisma/client';
import type { StoredWaUser } from '../../ports/persistence/wa-users.repo.port';
import { WA_USERS_REPO, type WaUsersRepoPort } from '../../ports/persistence/wa-users.repo.port';

@Injectable()
export class WaUsersService {
  private readonly logger = new Logger(WaUsersService.name);

  constructor(@Inject(WA_USERS_REPO) private readonly repo: WaUsersRepoPort) {}

  /** Camino canónico multi-canal: identifica al usuario por (canal, id-de-canal). */
  async upsertByChannel(
    channel: UserChannel,
    channelUserId: string,
    displayName?: string | null,
  ): Promise<StoredWaUser> {
    const user = await this.repo.upsertByChannel(channel, channelUserId, displayName);
    this.logger.debug(`Upserted wa_user ${user.id} (${channel}:${channelUserId})`);
    return user;
  }

  async upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser> {
    return this.upsertByChannel('whatsapp', phoneE164, displayName);
  }
}
