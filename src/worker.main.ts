import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  process.env.SERVICE = process.env.SERVICE ?? 'worker';

  const app = await NestFactory.create(WorkerModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);
  // Railway inyecta $PORT por servicio; si no, usamos WORKER_PORT.
  const port = Number(process.env.PORT) || config.get('WORKER_PORT', { infer: true });

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`Worker service listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker bootstrap failed:', err);
  process.exit(1);
});
