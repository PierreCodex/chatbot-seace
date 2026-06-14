import { Module } from '@nestjs/common';
import { MESSAGING_PORT } from '../../../ports/messaging.port';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramClient } from './telegram.client';

@Module({
  providers: [TelegramClient, { provide: MESSAGING_PORT, useClass: TelegramAdapter }],
  exports: [MESSAGING_PORT],
})
export class TelegramMessagingModule {}
