import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JOB_NAMES, SCRAPE_QUEUE } from '../jobs/job-types';
import type { SearchJobData, SearchJobResult } from '../jobs/search.job';
import { PROCESSES_REPO, type ProcessesRepoPort } from '../ports/persistence/processes.repo.port';
import { JOB_CONSUMER_PORT, type JobConsumerPort, type JobHandlerCtx } from '../ports/queue.port';
import { SCRAPER_PORT, type ScraperPort } from '../ports/scraper.port';

/**
 * Procesa los jobs de scraping en la cola `scrape`. Solo conoce ports —
 * la mecánica de bullmq vive en el adapter `BullMqConsumer`.
 */
@Injectable()
export class ScrapeProcessor implements OnModuleInit {
  private readonly logger = new Logger(ScrapeProcessor.name);

  constructor(
    @Inject(JOB_CONSUMER_PORT) private readonly consumer: JobConsumerPort,
    @Inject(SCRAPER_PORT) private readonly scraper: ScraperPort,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.register<SearchJobData, SearchJobResult>({
      queue: SCRAPE_QUEUE,
      jobNames: [JOB_NAMES.SEARCH_ON_DEMAND, JOB_NAMES.CRAWL_SCHEDULED],
      concurrency: 1,
      handler: (data, ctx) => this.handle(data, ctx),
    });
  }

  private async handle(data: SearchJobData, ctx: JobHandlerCtx): Promise<SearchJobResult> {
    const reqId = data.trace?.requestId ?? ctx.jobId;
    this.logger.log(
      `[${reqId}] scrape ${data.tab} attempt=${ctx.attemptsMade + 1} filters=${JSON.stringify(data.filters)}`,
    );

    const result = await this.scraper.search(data.tab, data.filters);
    const upsert = await this.processes.upsertMany(result.rows);

    this.logger.log(
      `[${reqId}] done rows=${result.rows.length} inserted=${upsert.inserted} updated=${upsert.updated} unchanged=${upsert.unchanged} ms=${result.durationMs}`,
    );

    return {
      source: 'live',
      inserted: upsert.inserted,
      updated: upsert.updated,
      unchanged: upsert.unchanged,
      rowCount: result.rows.length,
      totalReported: result.totalReported,
      totalPages: result.totalPages,
      pagesScraped: result.pagesScraped,
      durationMs: result.durationMs,
      resultIds: upsert.ids,
    };
  }
}
