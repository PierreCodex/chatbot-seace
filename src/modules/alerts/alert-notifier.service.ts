import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { MESSAGING_PORT, type MessagingPort } from '../../ports/messaging.port';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
} from '../../ports/persistence/processes.repo.port';
import {
  SUBSCRIPTION_HITS_REPO,
  type SubscriptionHitsRepoPort,
} from '../../ports/persistence/subscription-hits.repo.port';
import {
  SUBSCRIPTIONS_REPO,
  type StoredSubscription,
  type SubscriptionsRepoPort,
} from '../../ports/persistence/subscriptions.repo.port';
import { WA_USERS_REPO, type WaUsersRepoPort } from '../../ports/persistence/wa-users.repo.port';
import { AlertPresenter } from './alert.presenter';
import type { DetectedHits } from './hit-detection.service';

const PENDING_LIMIT = 50;
const LIMA_TZ = 'America/Lima';

/**
 * Notifier (docs/09 §2.1): entrega los hits pendientes según la frecuencia.
 *  - `hourly` → inmediata al detectar (tras la corrida del crawler).
 *  - `daily` / `weekly` → digest agendado.
 * `deliverPending` es la primitiva común; los crons solo la invocan por frecuencia.
 */
@Injectable()
export class AlertNotifierService {
  private readonly logger = new Logger(AlertNotifierService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(SUBSCRIPTIONS_REPO) private readonly subs: SubscriptionsRepoPort,
    @Inject(SUBSCRIPTION_HITS_REPO) private readonly hits: SubscriptionHitsRepoPort,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    @Inject(WA_USERS_REPO) private readonly users: WaUsersRepoPort,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly presenter: AlertPresenter,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('CRAWLER_ENABLED', { infer: true }) ?? false;
  }

  /** Entrega inmediata: solo las alertas `hourly` que recibieron hits en el crawl. */
  async notifyImmediate(grouped: DetectedHits): Promise<void> {
    for (const { sub } of grouped.values()) {
      if (sub.frequency === 'hourly') await this.deliverPending(sub);
    }
  }

  @Cron('0 0 8 * * *', { name: 'alerts-daily', timeZone: LIMA_TZ })
  async dailyDigest(): Promise<void> {
    if (!this.enabled) return;
    await this.runDigest('daily');
  }

  @Cron('0 0 8 * * 1', { name: 'alerts-weekly', timeZone: LIMA_TZ })
  async weeklyDigest(): Promise<void> {
    if (!this.enabled) return;
    await this.runDigest('weekly');
  }

  private async runDigest(frequency: 'daily' | 'weekly'): Promise<void> {
    const subs = await this.subs.listActiveByFrequency(frequency);
    let sent = 0;
    for (const sub of subs) sent += (await this.deliverPending(sub)) ? 1 : 0;
    if (sent > 0) this.logger.log(`digest ${frequency}: ${sent} alertas entregadas`);
  }

  /**
   * Preview de delivery (dev/local): envía a `toChatId` un aviso de la alerta con
   * los anuncios actuales que matchean sus filtros, **sin** crear/consumir hits.
   * Sirve para validar la entrega en Telegram sin esperar a que SEACE publique.
   */
  async previewSub(sub: StoredSubscription, toChatId: string): Promise<number> {
    const procs = await this.processes.findByFilters(
      'anuncios_futuros',
      {
        objeto: sub.objeto ?? undefined,
        entityNombre: sub.entityNombre ?? undefined,
        // F2: el preview respeta el tema de la alerta (mismo criterio del matcher).
        keywords: sub.keywordTerms?.length ? sub.keywordTerms : undefined,
      },
      { limit: 5 },
    );
    if (procs.length === 0) return 0;
    await this.messaging.send(this.presenter.build(toChatId, sub, procs));
    return procs.length;
  }

  /** Entrega los hits pendientes de UNA alerta. Devuelve cuántos anuncios entregó. */
  async deliverPending(sub: StoredSubscription): Promise<number> {
    const pending = await this.hits.listPending(sub.id, PENDING_LIMIT);
    if (pending.length === 0) return 0;
    const user = await this.users.findById(sub.userId);
    if (!user) return 0;

    const procs = await this.processes.findManyByIds(pending.map((h) => h.processId));
    if (procs.length === 0) {
      // Procesos borrados: marca los hits como notificados para no reintentar.
      await this.hits.markNotified(pending.map((h) => h.id));
      return 0;
    }
    try {
      await this.messaging.send(this.presenter.build(user.channelUserId, sub, procs));
    } catch (err) {
      this.logger.error(`entrega de alerta ${sub.id} falló: ${(err as Error).message}`);
      return 0; // no marca notificado → reintenta en la próxima corrida
    }
    await this.hits.markNotified(pending.map((h) => h.id));
    await this.subs.markRun(sub.id, procs.length, null);
    this.logger.log(`alerta ${sub.id} → ${user.channelUserId} (${procs.length} anuncios)`);
    return procs.length;
  }
}
