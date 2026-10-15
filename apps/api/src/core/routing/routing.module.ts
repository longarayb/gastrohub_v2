import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import {
  NoRoutingProvider,
  OsrmRoutingProvider,
  ROUTING_PROVIDER,
  RoutingService,
} from './routing.js';

@Global()
@Module({
  providers: [
    {
      provide: ROUTING_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.get('ROUTING_PROVIDER') === 'osrm'
          ? new OsrmRoutingProvider(config)
          : new NoRoutingProvider(),
    },
    RoutingService,
  ],
  exports: [ROUTING_PROVIDER, RoutingService],
})
export class RoutingModule {}
