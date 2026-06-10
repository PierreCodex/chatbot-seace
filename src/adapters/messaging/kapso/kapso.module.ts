import { Module } from '@nestjs/common';
import { MESSAGING_PORT } from '../../../ports/messaging.port';
import { KapsoAdapter } from './kapso.adapter';
import { KapsoClient } from './kapso.client';

@Module({
  providers: [KapsoClient, { provide: MESSAGING_PORT, useClass: KapsoAdapter }],
  exports: [MESSAGING_PORT],
})
export class KapsoMessagingModule {}
