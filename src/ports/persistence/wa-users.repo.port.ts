import type { WaUser as PrismaWaUser } from '@prisma/client';

export type StoredWaUser = PrismaWaUser;

export interface WaUsersRepoPort {
  upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser>;
  findById(id: string): Promise<StoredWaUser | null>;
  findByPhone(phoneE164: string): Promise<StoredWaUser | null>;
}

export const WA_USERS_REPO = Symbol('WA_USERS_REPO');
