import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config.service.js';
import { NoRoutingProvider, OsrmRoutingProvider, RoutingService } from './routing.js';

const config = {
  get: (key: string) => ({ OSRM_URL: 'https://osrm.test', APP_NAME: 'App' })[key],
} as unknown as AppConfig;

const STORE = { latitude: -23.5649, longitude: -46.6519 };
const A = { latitude: -23.5549, longitude: -46.6519 };
const B = { latitude: -23.5449, longitude: -46.6519 };

describe('RoutingService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the straight line when the routing server fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const routing = new RoutingService(new OsrmRoutingProvider(config));
    expect(routing.configured).toBe('OSRM');

    const { matrix, source } = await routing.matrix([STORE, A, B]);
    expect(source).toBe('STRAIGHT');
    expect(matrix.durations[0]![1]).toBeLessThan(matrix.durations[0]![2]!);

    const route = await routing.route([STORE, A, B]);
    expect(route.source).toBe('STRAIGHT');
    expect(route.legs).toHaveLength(2);
    expect(route.geometry).toEqual([
      [STORE.longitude, STORE.latitude],
      [A.longitude, A.latitude],
      [B.longitude, B.latitude],
    ]);
    expect(route.distanceMeters).toBeGreaterThan(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Identifies itself to the public server (usage policy).
    expect(fetch.mock.calls[0]![1].headers['User-Agent']).toContain('App');
  });

  it('uses the routing server answer when it comes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'Ok',
            routes: [
              {
                distance: 2500.4,
                duration: 400.6,
                geometry: {
                  coordinates: [
                    [-46.65, -23.56],
                    [-46.64, -23.55],
                  ],
                },
                legs: [{ distance: 2500.4, duration: 400.6 }],
              },
            ],
          }),
        ),
      ),
    );
    const route = await new RoutingService(new OsrmRoutingProvider(config)).route([STORE, A]);
    expect(route).toMatchObject({ source: 'OSRM', distanceMeters: 2500, durationSeconds: 401 });
  });

  it('routing off: straight line without calling anyone', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const routing = new RoutingService(new NoRoutingProvider());
    expect((await routing.route([STORE, A])).source).toBe('STRAIGHT');
    expect(fetch).not.toHaveBeenCalled();
  });
});
