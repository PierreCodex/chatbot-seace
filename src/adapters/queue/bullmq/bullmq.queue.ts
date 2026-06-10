import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { SCRAPE_QUEUE } from '../../../jobs/job-types';
import type {
  AddOptions,
  EnqueuedJob,
  JobCompletedListener,
  JobFailedListener,
  JobInfo,
  QueuePort,
} from '../../../ports/queue.port';
import { BullMqConnection } from './bullmq.connection';

@Injectable()
export class BullMqQueue implements QueuePort, OnModuleDestroy {
  private readonly logger = new Logger(BullMqQueue.name);
  private readonly queue: Queue;
  private readonly events: QueueEvents;

  // Queue/QueueEvents se crean acá (no en onModuleInit) para que otros
  // OnModuleInit que dependen de QUEUE_PORT — p.ej. SearchResultsListener
  // registrando onJobCompleted — encuentren `this.events` ya inicializado.
  constructor(private readonly conn: BullMqConnection) {
    this.queue = new Queue(SCRAPE_QUEUE, { connection: this.conn.client });
    this.events = new QueueEvents(SCRAPE_QUEUE, { connection: this.conn.client });
    this.events.on('failed', ({ jobId, failedReason }) =>
      this.logger.warn(`job ${jobId} failed: ${failedReason}`),
    );
    this.events.on('completed', ({ jobId }) => this.logger.debug(`job ${jobId} completed`));
  }

  onJobCompleted(listener: JobCompletedListener): void {
    this.events.on('completed', ({ jobId }) => {
      Promise.resolve(listener({ jobId })).catch((err) =>
        this.logger.error(`completed listener throw: ${(err as Error).message}`),
      );
    });
  }

  onJobFailed(listener: JobFailedListener): void {
    this.events.on('failed', ({ jobId, failedReason }) => {
      Promise.resolve(listener({ jobId, failedReason })).catch((err) =>
        this.logger.error(`failed listener throw: ${(err as Error).message}`),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close();
    await this.queue?.close();
  }

  async add<T>(name: string, data: T, opts?: AddOptions): Promise<EnqueuedJob> {
    const job = await this.queue.add(name, data, this.toBullOpts(opts));
    return { id: String(job.id), name };
  }

  async addBulk<T>(
    jobs: Array<{ name: string; data: T; opts?: AddOptions }>,
  ): Promise<EnqueuedJob[]> {
    const added = await this.queue.addBulk(
      jobs.map((j) => ({ name: j.name, data: j.data as object, opts: this.toBullOpts(j.opts) })),
    );
    return added.map((j) => ({ id: String(j.id), name: j.name }));
  }

  async getJob<TData = unknown, TResult = unknown>(
    id: string,
  ): Promise<JobInfo<TData, TResult> | null> {
    const job = await this.queue.getJob(id);
    if (!job) return null;
    const state = (await job.getState()) as JobInfo['state'];
    return {
      id: String(job.id),
      name: job.name,
      data: job.data as TData,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn ?? null,
      failedReason: job.failedReason ?? null,
      returnValue: (job.returnvalue ?? null) as TResult | null,
      state,
    };
  }

  private toBullOpts(opts?: AddOptions) {
    if (!opts) return undefined;
    return {
      priority: opts.priority,
      attempts: opts.attempts,
      delay: opts.delayMs,
      jobId: opts.jobId,
      ...(opts.backoff && { backoff: opts.backoff }),
    };
  }
}
