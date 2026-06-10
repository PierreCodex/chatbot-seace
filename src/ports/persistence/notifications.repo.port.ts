import type { Notification as PrismaNotification, Prisma } from '@prisma/client';
import type { NotifKind } from './types';

export type StoredNotification = PrismaNotification;

export interface NotificationCreateInput {
  userId: string;
  kind: NotifKind;
  payload: Prisma.InputJsonValue;
}

export interface NotificationsRepoPort {
  create(data: NotificationCreateInput): Promise<StoredNotification>;
  markSent(id: string, kapsoMsgId: string): Promise<StoredNotification>;
  markFailed(id: string, error: string): Promise<StoredNotification>;
}

export const NOTIFICATIONS_REPO = Symbol('NOTIFICATIONS_REPO');
