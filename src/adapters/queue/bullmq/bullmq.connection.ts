import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../../config/env.schema';

/**
 * Conexión Redis dedicada para BullMQ. NO se reusa la del adapter de cache
 * porque BullMQ exige `maxRetriesPerRequest: null` para los blocking commands
 * (BRPOPLPUSH) del worker.
 */
@Injectable()
export class BullMqConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqConnection.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.client.on('error', (err) => this.logger.error(`BullMQ Redis error: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    // BullMQ's QueueEvents puede haber iniciado la conexión durante la
    // construcción de BullMqQueue. ioredis tira si llamamos connect() mientras
    // ya está 'connecting'/'connect'/'ready' — sólo conectamos si sigue lazy.
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`BullMQ Redis PING returned ${reply}`);
    }
    this.logger.log('BullMQ Redis connection OK');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
