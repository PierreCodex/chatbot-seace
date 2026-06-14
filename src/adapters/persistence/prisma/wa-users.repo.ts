import { Injectable } from '@nestjs/common';
import type { UserChannel } from '@prisma/client';
import type { StoredWaUser, WaUsersRepoPort } from '../../../ports/persistence/wa-users.repo.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaWaUsersRepo implements WaUsersRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByChannel(
    channel: UserChannel,
    channelUserId: string,
    displayName?: string | null,
  ): Promise<StoredWaUser> {
    // En WhatsApp el id-de-canal ES el teléfono → espejarlo en phoneE164.
    const phoneE164 = channel === 'whatsapp' ? channelUserId : null;
    return this.prisma.waUser.upsert({
      where: { channel_channelUserId: { channel, channelUserId } },
      create: {
        channel,
        channelUserId,
        phoneE164,
        ...(displayName !== undefined ? { displayName } : {}),
      },
      update: {
        lastActiveAt: new Date(),
        totalMessages: { increment: 1 },
        ...(displayName !== undefined ? { displayName } : {}),
      },
    });
  }

  async upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser> {
    return this.upsertByChannel('whatsapp', phoneE164, displayName);
  }

  findById(id: string): Promise<StoredWaUser | null> {
    return this.prisma.waUser.findUnique({ where: { id } });
  }

  findByPhone(phoneE164: string): Promise<StoredWaUser | null> {
    return this.prisma.waUser.findUnique({ where: { phoneE164 } });
  }
}
