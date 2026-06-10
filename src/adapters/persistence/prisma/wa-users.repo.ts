import { Injectable } from '@nestjs/common';
import type { StoredWaUser, WaUsersRepoPort } from '../../../ports/persistence/wa-users.repo.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaWaUsersRepo implements WaUsersRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser> {
    return this.prisma.waUser.upsert({
      where: { phoneE164 },
      create: {
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

  findById(id: string): Promise<StoredWaUser | null> {
    return this.prisma.waUser.findUnique({ where: { id } });
  }

  findByPhone(phoneE164: string): Promise<StoredWaUser | null> {
    return this.prisma.waUser.findUnique({ where: { phoneE164 } });
  }
}
