import { Global, Module } from '@nestjs/common';
import { PUSH_PROVIDER } from '../../core/push/push.types.js';
import { WebPushProvider } from '../../core/push/web-push.provider.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

/** Web Push (D049); global: the dispatch and the kitchen notify the courier. */
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PUSH_PROVIDER, useClass: WebPushProvider }],
  exports: [PushService],
})
export class PushModule {}
