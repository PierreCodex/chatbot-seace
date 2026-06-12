import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaPersistenceModule } from './adapters/persistence/prisma/prisma.module';
import { RedisCacheModule } from './adapters/cache/redis/redis.module';
import { BullMqQueueModule } from './adapters/queue/bullmq/bullmq.module';
import { FilesModule } from './adapters/files/files.module';
import { HealthModule } from './common/health/health.module';
import { DevModule } from './modules/dev/dev.module';
import { BotModule } from './modules/bot/bot.module';
import { FilesHttpModule } from './modules/files/files.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaPersistenceModule,
    RedisCacheModule,
    BullMqQueueModule,
    FilesModule,
    HealthModule,
    DevModule,
    BotModule,
    FilesHttpModule,
    SearchModule,
  ],
})
export class AppModule {}
