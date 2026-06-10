import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { SearchJobResult } from '../../jobs/search.job';
import {
  MESSAGING_PORT,
  type MessagingPort,
  type OutboundMessage,
} from '../../ports/messaging.port';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
} from '../../ports/persistence/processes.repo.port';
import { QUEUE_PORT, type QueuePort } from '../../ports/queue.port';
import { SearchResultsPresenter } from './presenters/search-results.presenter';
import { SearchFacade } from './search.facade';

/**
 * Cuando un job de scrape termina, este listener decide si tiene que
 * notificar a un usuario por WhatsApp. Encuentra el contexto vía
 * `SearchFacade.getJobContext` (mapping en Redis); si no existe, el job
 * fue un crawler programado o un job de dev sin destinatario — lo ignora.
 */
@Injectable()
export class SearchResultsListener implements OnModuleInit {
  private readonly logger = new Logger(SearchResultsListener.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly facade: SearchFacade,
    private readonly presenter: SearchResultsPresenter,
  ) {}

  onModuleInit(): void {
    this.queue.onJobCompleted(({ jobId }) => this.handleCompleted(jobId));
    this.queue.onJobFailed(({ jobId, failedReason }) => this.handleFailed(jobId, failedReason));
  }

  private async handleCompleted(jobId: string): Promise<void> {
    const ctx = await this.facade.getJobContext(jobId);
    if (!ctx) return; // crawler / dev / job ya consumido

    const job = await this.queue.getJob<unknown, SearchJobResult>(jobId);
    if (!job || !job.returnValue) {
      this.logger.warn(`job ${jobId} sin returnValue, ignorando`);
      await this.facade.clearJobContext(jobId);
      return;
    }

    const resultIds = job.returnValue.resultIds ?? [];
    const processes = await this.processes.findManyByIds(resultIds);
    await this.facade.finalizeLiveSearch(ctx, processes, job.returnValue.durationMs);

    if (!ctx.phoneNumber || !ctx.phoneNumberId) {
      // Job sin destinatario (crawler) — sólo persistir métricas, ya hecho.
      await this.facade.clearJobContext(jobId);
      return;
    }

    const messages = this.presenter.build({
      phoneNumber: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      totalFound: job.returnValue.totalReported ?? processes.length,
      processes,
    });
    await this.sendAll(messages);
    await this.facade.clearJobContext(jobId);
    this.logger.log(`entregado job=${jobId} → ${ctx.phoneNumber} (${processes.length} procesos)`);
  }

  private async handleFailed(jobId: string, reason: string): Promise<void> {
    const ctx = await this.facade.getJobContext(jobId);
    if (!ctx) return;
    if (ctx.phoneNumber && ctx.phoneNumberId) {
      await this.sendAll([
        {
          kind: 'text',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          body: 'Tuve un problema buscando en SEACE. Intenta de nuevo en unos minutos.',
        },
      ]);
    }
    this.logger.warn(`job ${jobId} falló (${reason}) ctx=${ctx.userId ?? 'anon'}`);
    await this.facade.clearJobContext(jobId);
  }

  private async sendAll(messages: OutboundMessage[]): Promise<void> {
    for (const m of messages) {
      try {
        await this.messaging.send(m);
      } catch (err) {
        this.logger.error(`error enviando mensaje: ${(err as Error).message}`);
      }
    }
  }
}
