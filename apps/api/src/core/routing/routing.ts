import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Coordinates,
  type LineString,
  type RouteSource,
  type TravelMatrix,
  straightGeometry,
  straightLineMatrix,
} from '@app/shared';
import { AppConfig } from '../config/app-config.service.js';

export interface RouteResult {
  geometry: LineString;
  distanceMeters: number;
  durationSeconds: number;
  /** One leg between each pair of consecutive points. */
  legs: { distanceMeters: number; durationSeconds: number }[];
}

/**
 * Travel times and route lines (D048). OSRM to start (the public server only in development
 * and the demo; our own with the region extract in production). Never throws: `null` means
 * "unavailable", and `RoutingService` falls back to the straight-line estimate.
 */
export interface RoutingProvider {
  readonly name: RouteSource;
  matrix(points: readonly Coordinates[]): Promise<TravelMatrix | null>;
  route(points: readonly Coordinates[]): Promise<RouteResult | null>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
export const InjectRouting = () => Inject(ROUTING_PROVIDER);

/** Routing switched off (tests, offline): everything goes the straight-line way. */
export class NoRoutingProvider implements RoutingProvider {
  readonly name = 'STRAIGHT' as const;
  async matrix(): Promise<TravelMatrix | null> {
    return null;
  }
  async route(): Promise<RouteResult | null> {
    return null;
  }
}

const TIMEOUT_MS = 5_000;
/** The public OSRM server asks for light use: one request per second, like Nominatim. */
const MIN_INTERVAL_MS = 1_000;

const coords = (points: readonly Coordinates[]) =>
  points.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(';');

@Injectable()
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'OSRM' as const;
  private readonly logger = new Logger('Routing');
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly config: AppConfig) {}

  private call<T>(path: string): Promise<T | null> {
    const run = this.queue.then(() => this.request<T>(path));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request<T>(path: string): Promise<T | null> {
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    try {
      const response = await fetch(new URL(path, this.config.get('OSRM_URL')), {
        headers: { 'User-Agent': `${this.config.get('APP_NAME')} (food service dispatch)` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`OSRM respondeu ${response.status}`);
        return null;
      }
      const body = (await response.json()) as T & { code?: string };
      if (body.code && body.code !== 'Ok') {
        this.logger.warn(`OSRM: ${body.code}`);
        return null;
      }
      return body;
    } catch (error) {
      this.logger.warn(`Rotas indisponíveis: ${(error as Error).message}`);
      return null;
    }
  }

  async matrix(points: readonly Coordinates[]): Promise<TravelMatrix | null> {
    const body = await this.call<{ durations?: number[][]; distances?: number[][] }>(
      `/table/v1/driving/${coords(points)}?annotations=duration,distance`,
    );
    if (!body?.durations || !body.distances) return null;
    const round = (m: number[][]) => m.map((row) => row.map((v) => Math.round(v ?? 0)));
    return { durations: round(body.durations), distances: round(body.distances) };
  }

  async route(points: readonly Coordinates[]): Promise<RouteResult | null> {
    if (points.length < 2) return null;
    const body = await this.call<{
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: LineString };
        legs: { distance: number; duration: number }[];
      }[];
    }>(`/route/v1/driving/${coords(points)}?overview=full&geometries=geojson&steps=false`);
    const route = body?.routes?.[0];
    if (!route) return null;
    return {
      geometry: route.geometry.coordinates,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      legs: route.legs.map((l) => ({
        distanceMeters: Math.round(l.distance),
        durationSeconds: Math.round(l.duration),
      })),
    };
  }
}

/**
 * What the dispatch uses: the provider when it answers, the straight-line estimate when it is off
 * or fails (the dispatch keeps working; the screen says the estimate is in a straight line).
 */
@Injectable()
export class RoutingService {
  constructor(@InjectRouting() private readonly provider: RoutingProvider) {}

  get configured(): RouteSource {
    return this.provider.name;
  }

  async matrix(
    points: readonly Coordinates[],
  ): Promise<{ matrix: TravelMatrix; source: RouteSource }> {
    const matrix = points.length > 1 ? await this.provider.matrix(points) : null;
    return matrix
      ? { matrix, source: this.provider.name }
      : { matrix: straightLineMatrix(points), source: 'STRAIGHT' };
  }

  async route(points: readonly Coordinates[]): Promise<RouteResult & { source: RouteSource }> {
    const found = await this.provider.route(points);
    if (found) return { ...found, source: this.provider.name };
    const { distances, durations } = straightLineMatrix(points);
    const legs = points.slice(1).map((_, i) => ({
      distanceMeters: distances[i]![i + 1]!,
      durationSeconds: durations[i]![i + 1]!,
    }));
    return {
      geometry: straightGeometry(points),
      distanceMeters: legs.reduce((sum, l) => sum + l.distanceMeters, 0),
      durationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
      legs,
      source: 'STRAIGHT',
    };
  }
}
