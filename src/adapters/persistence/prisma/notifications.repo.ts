import { Injectable } from '@nestjs/common';
import type {
  NotificationCreateInput,
  NotificationsRepoPort,
  StoredNotification,
} from '../../../ports/persistence/notifications.repo.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaNotificationsRepo implements NotificationsRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NotificationCreateInput): Promise<StoredNotification> {
    return this.prisma.notification.create({
      data: {
        user: { connect: { id: data.userId } },
        kind: data.kind,
        payload: data.payload,
      },
    });
  }

  markSent(id: string, kapsoMsgId: string): Promise<StoredNotification> {
    return this.prisma.notification.update({
      where: { id },
      data: { status: 'sent', kapsoMsgId, sentAt: new Date() },
    });
  }

  markFailed(id: string, error: string): Promise<StoredNotification> {
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: 'failed',
        error,
        attempts: { increment: 1 },
      },
    });
  }
}
