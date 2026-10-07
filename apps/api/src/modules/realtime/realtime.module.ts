import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';
import { TrackingGateway } from './tracking.gateway.js';

@Global()
@Module({
  providers: [RealtimeGateway, TrackingGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
