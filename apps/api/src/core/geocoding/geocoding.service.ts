import { Injectable } from '@nestjs/common';
import { normalizePlace, onlyDigits } from '@app/shared';
import { type Db, InjectDb } from '../tenancy/db.provider.js';
import {
  type GeocodeQuery,
  type GeocodeResult,
  type GeocodingProvider,
  InjectGeocoding,
} from './geocoding.js';

/** A miss is retried only after this long (the address may get mapped in OpenStreetMap). */
const MISS_TTL_MS = 7 * 24 * 3_600_000;

/** Cache key of an address: CEP, number and the normalized street and city. */
export function geocodeKey(q: GeocodeQuery): string {
  return [
    onlyDigits(q.cep),
    normalizePlace(q.number),
    normalizePlace(q.street),
    normalizePlace(q.city),
  ]
    .join('|')
    .slice(0, 300);
}

/**
 * Geocoding with the unit's cache (D048): each address is asked once (the public Nominatim allows
 * light use only: 1 request per second, no bulk). A pin moved on the map replaces the cached
 * point (`remember`), so the same address starts right next time.
 */
@Injectable()
export class GeocodingService {
  constructor(
    @InjectDb() private readonly db: Db,
    @InjectGeocoding() private readonly provider: GeocodingProvider,
  ) {}

  async geocode(
    query: GeocodeQuery,
  ): Promise<(GeocodeResult & { source: 'GEOCODER' | 'MANUAL' }) | null> {
    const key = geocodeKey(query);
    const cached = await this.db.geocodeCache.findFirst({ where: { key } });
    if (cached) {
      if (cached.latitude != null && cached.longitude != null) {
        return {
          latitude: cached.latitude,
          longitude: cached.longitude,
          precision: cached.precision ?? 'STREET',
          source: cached.source === 'MANUAL' ? 'MANUAL' : 'GEOCODER',
        };
      }
      if (Date.now() - cached.updatedAt.getTime() < MISS_TTL_MS) return null;
    }
    const found = await this.provider.geocode(query);
    const data = {
      latitude: found?.latitude ?? null,
      longitude: found?.longitude ?? null,
      precision: found?.precision ?? null,
      source: 'GEOCODER' as const,
    };
    if (cached) await this.db.geocodeCache.update({ where: { id: cached.id }, data });
    else await this.db.geocodeCache.create({ data: { key, ...data } });
    return found ? { ...found, source: 'GEOCODER' } : null;
  }

  /** The operator placed the pin: this address is here from now on. */
  async remember(
    query: GeocodeQuery,
    point: { latitude: number; longitude: number },
  ): Promise<void> {
    const key = geocodeKey(query);
    const data = { ...point, precision: 'HOUSE' as const, source: 'MANUAL' as const };
    const cached = await this.db.geocodeCache.findFirst({ where: { key } });
    if (cached) await this.db.geocodeCache.update({ where: { id: cached.id }, data });
    else await this.db.geocodeCache.create({ data: { key, ...data } });
  }
}
