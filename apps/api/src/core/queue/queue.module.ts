import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.service.js';
import { QUEUES } from './queue.constants.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: null }),
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
