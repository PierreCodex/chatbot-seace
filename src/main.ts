import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  process.env.SERVICE = process.env.SERVICE ?? 'api';

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('API_PORT', { infer: true });

  app.enableShutdownHooks();
  await app.listen(port);

  new Logger('Bootstrap').log(`API service listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('API bootstrap failed:', err);
  process.exit(1);
});
