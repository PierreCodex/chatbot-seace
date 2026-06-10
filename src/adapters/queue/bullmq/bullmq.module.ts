import { Global, Module } from '@nestjs/common';
import { JOB_CONSUMER_PORT, QUEUE_PORT } from '../../../ports/queue.port';
import { BullMqConnection } from './bullmq.connection';
import { BullMqConsumer } from './bullmq.consumer';
import { BullMqQueue } from './bullmq.queue';

@Global()
@Module({
  providers: [
    BullMqConnection,
    { provide: QUEUE_PORT, useClass: BullMqQueue },
    { provide: JOB_CONSUMER_PORT, useClass: BullMqConsumer },
  ],
  exports: [QUEUE_PORT, JOB_CONSUMER_PORT],
})
export class BullMqQueueModule {}
