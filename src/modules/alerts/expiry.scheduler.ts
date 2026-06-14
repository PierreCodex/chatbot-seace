import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { MESSAGING_PORT, type MessagingPort } from '../../ports/messaging.port';
import { ADMIN_REPO, type AdminRepoPort } from '../../ports/persistence/admin.repo.port';
import {
  SUBSCRIPTIONS_REPO,
  type SubscriptionsRepoPort,
} from '../../ports/persistence/subscriptions.repo.port';

const LIMA_TZ = 'America/Lima';

/**
 * Job de expiración (docs/09 §7, docs/17 fase 7). Una vez al día (03:30 Lima, tras
 * el crawl completo) en el worker:
 *  - marca como `expired` las alertas cuya vigencia pasó (`subscriptions.expires_at`).
 *  - baja a `free` los Premium vencidos (`AdminRepo.expireOverdue`, audita `auto_vencido`)
 *    y le avisa al usuario.
 * El plan efectivo ya respeta el vencimiento de forma lazy; esto consolida el estado.
 */
@Injectable()
export class ExpiryScheduler {
  private readonly logger = new Logger(ExpiryScheduler.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(SUBSCRIPTIONS_REPO) private readonly subs: SubscriptionsRepoPort,
    @Inject(ADMIN_REPO) private readonly admin: AdminRepoPort,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('CRAWLER_ENABLED', { infer: true }) ?? false;
  }

  @Cron('0 30 3 * * *', { name: 'alerts-expiry', timeZone: LIMA_TZ })
  async daily(): Promise<void> {
    if (!this.enabled) return;
    await this.runOnce();
  }

  /** Ejecuta una pasada de expiración. Reusado por el cron y por pruebas. */
  async runOnce(): Promise<{ expiredSubs: number; downgraded: number }> {
    const expiredSubs = await this.subs.expireOverdue();

    const users = await this.admin.expireOverdue('system');
    for (const u of users) {
      if (u.channel !== 'telegram') continue;
      try {
        await this.messaging.send({
          kind: 'text',
          to: u.channelUserId,
          phoneNumberId: '',
          html: true,
          body: '⏳ Tu plan <b>Premium</b> venció — volviste a <b>Free</b>. Podés renovarlo cuando quieras 💎',
        });
      } catch (err) {
        this.logger.warn(
          `aviso de vencimiento a ${u.channelUserId} falló: ${(err as Error).message}`,
        );
      }
    }

    if (expiredSubs > 0 || users.length > 0) {
      this.logger.log(`expiry: ${expiredSubs} alertas expiradas · ${users.length} premium→free`);
    }
    return { expiredSubs, downgraded: users.length };
  }
}
