import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaPersistenceModule } from './adapters/persistence/prisma/prisma.module';
import { RedisCacheModule } from './adapters/cache/redis/redis.module';
import { HealthModule } from './common/health/health.module';

@Module({
  imports: [AppConfigModule, PrismaPersistenceModule, RedisCacheModule, HealthModule],
})
export class AppModule {}
