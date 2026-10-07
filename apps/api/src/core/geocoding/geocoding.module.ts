import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import {
  GEOCODING_PROVIDER,
  NominatimGeocodingProvider,
  NoopGeocodingProvider,
} from './geocoding.js';

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
  ],
  exports: [GEOCODING_PROVIDER],
})
export class GeocodingModule {}
