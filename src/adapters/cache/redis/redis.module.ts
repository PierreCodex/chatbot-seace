import { Global, Module } from '@nestjs/common';
import { CACHE_PORT } from '../../../ports/cache.port';
import { RedisCache } from './redis.client';

@Global()
@Module({
  providers: [{ provide: CACHE_PORT, useClass: RedisCache }],
  exports: [CACHE_PORT],
})
export class RedisCacheModule {}
