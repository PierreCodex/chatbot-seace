import type { UserChannel, WaUser as PrismaWaUser } from '@prisma/client';

export type StoredWaUser = PrismaWaUser;

export interface WaUsersRepoPort {
  /**
   * Upsert por identidad de canal: (channel, channelUserId). `channelUserId` es el
   * chat_id en Telegram o el teléfono en WhatsApp. Para WhatsApp, además espeja el
   * valor en `phoneE164`. Es el camino canónico multi-canal.
   */
  upsertByChannel(
    channel: UserChannel,
    channelUserId: string,
    displayName?: string | null,
  ): Promise<StoredWaUser>;
  /** Atajo WhatsApp: equivale a upsertByChannel('whatsapp', phoneE164, ...). */
  upsertByPhone(phoneE164: string, displayName?: string | null): Promise<StoredWaUser>;
  findById(id: string): Promise<StoredWaUser | null>;
  findByPhone(phoneE164: string): Promise<StoredWaUser | null>;
}

export const WA_USERS_REPO = Symbol('WA_USERS_REPO');
