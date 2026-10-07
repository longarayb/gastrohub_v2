import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import { QUEUES } from './queue.constants.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        // Options, not an ioredis instance: BullMQ only closes connections it creates, so a
        // shared instance would stay open after app.close().
        connection: { url: config.get('REDIS_URL'), maxRetriesPerRequest: null },
        // Separate keys per environment: the e2e tests never share jobs with a running dev API.
        prefix: config.get('QUEUE_PREFIX'),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.PRINT },
      { name: QUEUES.INTEGRATIONS },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
