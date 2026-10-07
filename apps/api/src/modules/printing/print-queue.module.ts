import { Module } from '@nestjs/common';
import { PrintQueueService } from './print-queue.service.js';

/** The print outbox used by the order flows (no dependency on the order services). */
@Module({
  providers: [PrintQueueService],
  exports: [PrintQueueService],
})
export class PrintQueueModule {}
