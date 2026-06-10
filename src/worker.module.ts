import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaPersistenceModule } from './adapters/persistence/prisma/prisma.module';
import { RedisCacheModule } from './adapters/cache/redis/redis.module';
import { BullMqQueueModule } from './adapters/queue/bullmq/bullmq.module';
import { SeaceScraperModule } from './adapters/scraper/seace/seace.module';
import { HealthModule } from './common/health/health.module';
import { ScrapeProcessor } from './workers/scrape.processor';

@Module({
  imports: [
    AppConfigModule,
    PrismaPersistenceModule,
    RedisCacheModule,
    BullMqQueueModule,
    SeaceScraperModule,
    HealthModule,
  ],
  providers: [ScrapeProcessor],
})
export class WorkerModule {}
