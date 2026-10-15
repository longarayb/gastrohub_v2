import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import {
  GEOCODING_PROVIDER,
  NominatimGeocodingProvider,
  NoopGeocodingProvider,
} from './geocoding.js';
import { GeocodingService } from './geocoding.service.js';

@Global()
@Module({
  providers: [
    {
      provide: GEOCODING_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.get('GEOCODING_PROVIDER') === 'nominatim'
          ? new NominatimGeocodingProvider(config)
          : new NoopGeocodingProvider(),
    },
    GeocodingService,
  ],
  exports: [GEOCODING_PROVIDER, GeocodingService],
})
export class GeocodingModule {}
