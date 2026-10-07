import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Coordinates } from '@app/shared';
import { AppConfig } from '../config/app-config.service.js';

/** Only the address goes to the provider: never the customer's name or phone (D029, LGPD). */
export interface GeocodeQuery {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
}

/**
 * Address → coordinates. Nominatim (free, 1 request/second) to start; production with volume
 * needs a paid service or a self-hosted Nominatim behind the same interface (docs/DECISOES.md).
 * Never throws: `null` means "not found / unavailable" and the operator picks the area by hand.
 */
export interface GeocodingProvider {
  geocode(query: GeocodeQuery): Promise<Coordinates | null>;
}

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');
export const InjectGeocoding = () => Inject(GEOCODING_PROVIDER);

export class NoopGeocodingProvider implements GeocodingProvider {
  async geocode(): Promise<Coordinates | null> {
    return null;
  }
}

const TIMEOUT_MS = 3_000;
const MIN_INTERVAL_MS = 1_000;

@Injectable()
export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly logger = new Logger('Geocoding');
  /** Serializes requests to respect the usage policy (max 1 request per second). */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly config: AppConfig) {}

  geocode(query: GeocodeQuery): Promise<Coordinates | null> {
    const run = this.queue.then(() => this.request(query));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request(query: GeocodeQuery): Promise<Coordinates | null> {
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const url = new URL('/search', this.config.get('NOMINATIM_URL'));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('street', `${query.number} ${query.street}`);
    url.searchParams.set('city', query.city);
    url.searchParams.set('state', query.state);
    url.searchParams.set('postalcode', query.cep);
    const email = this.config.get('NOMINATIM_EMAIL');
    if (email) url.searchParams.set('email', email);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': `${this.config.get('APP_NAME')} (food service)` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim respondeu ${response.status}`);
        return null;
      }
      const [hit] = (await response.json()) as { lat: string; lon: string }[];
      if (!hit) return null;
      const latitude = Number(hit.lat);
      const longitude = Number(hit.lon);
      return Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null;
    } catch (error) {
      this.logger.warn(`Geocodificação indisponível: ${(error as Error).message}`);
      return null;
    }
  }
}
