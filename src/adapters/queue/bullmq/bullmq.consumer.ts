import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { JobConsumerPort, RegisterConsumerOptions } from '../../../ports/queue.port';
import { BullMqConnection } from './bullmq.connection';

@Injectable()
export class BullMqConsumer implements JobConsumerPort, OnModuleDestroy {
  private readonly logger = new Logger(BullMqConsumer.name);
  private readonly workers: Worker[] = [];

  constructor(private readonly conn: BullMqConnection) {}

  async register<TData, TResult>(opts: RegisterConsumerOptions<TData, TResult>): Promise<void> {
    const allowed = new Set(opts.jobNames);
    const worker = new Worker<TData, TResult>(
      opts.queue,
      async (job: Job<TData, TResult>) => {
        if (!allowed.has(job.name)) {
          throw new Error(`Job "${job.name}" no soportado en cola ${opts.queue}`);
        }
        return opts.handler(job.data, {
          jobId: String(job.id),
          jobName: job.name,
          attemptsMade: job.attemptsMade,
        });
      },
      { connection: this.conn.client, concurrency: opts.concurrency ?? 1 },
    );
    worker.on('failed', (job, err) =>
      this.logger.error(
        `[${opts.queue}] job ${job?.id ?? '?'} (${job?.name}) failed: ${err.message}`,
      ),
    );
    worker.on('completed', (job) =>
      this.logger.debug(`[${opts.queue}] job ${job.id} (${job.name}) completed`),
    );
    this.workers.push(worker);
    this.logger.log(
      `BullMQ consumer registrado en "${opts.queue}" para [${[...allowed].join(', ')}]`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
  }
}
