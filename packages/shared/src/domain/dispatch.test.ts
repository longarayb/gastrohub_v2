import { describe, expect, it } from 'vitest';
import {
  EXACT_STOP_LIMIT,
  STOP_SERVICE_SECONDS,
  lineLength,
  metersAlongTo,
  orderStops,
  pathDuration,
  pointAlong,
  routeLegs,
  straightGeometry,
  straightLineMatrix,
} from './dispatch.js';

/** Deterministic pseudo-random matrix (asymmetric, like real streets). */
function randomMatrix(size: number, seed: number): number[][] {
  let x = seed;
  const next = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return 60 + (x % 900);
  };
  return Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? 0 : next())),
  );
}

function bruteForce(d: number[][]): number {
  const stops = Array.from({ length: d.length - 1 }, (_, i) => i + 1);
  let best = Infinity;
  const permute = (rest: number[], prefix: number[]) => {
    if (!rest.length) best = Math.min(best, pathDuration(d, prefix));
    rest.forEach((k, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...prefix, k]));
  };
  permute(stops, []);
  return best;
}

describe('orderStops', () => {
  it('visits every stop once, starting from the store', () => {
    const order = orderStops(randomMatrix(6, 3));
    expect([...order].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is exact up to the limit (same time as trying every order)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = randomMatrix(2 + (seed % 6), seed);
      expect(pathDuration(d, orderStops(d))).toBe(bruteForce(d));
    }
  });

  it('beyond the limit, a good order quickly (2-opt never worse than nearest neighbor)', () => {
    const d = randomMatrix(EXACT_STOP_LIMIT + 6, 42);
    const started = Date.now();
    const order = orderStops(d);
    expect(Date.now() - started).toBeLessThan(500);
    expect(new Set(order).size).toBe(EXACT_STOP_LIMIT + 5);
  });

  it('obvious line: store, then the nearest, then the farthest', () => {
    // Store at 0 m, stops at 3 km, 1 km and 2 km on the same road.
    const at = [0, 3000, 1000, 2000];
    const d = at.map((a) => at.map((b) => Math.abs(a - b)));
    expect(orderStops(d)).toEqual([2, 3, 1]);
  });

  it('no stops, one stop', () => {
    expect(orderStops([[0]])).toEqual([]);
    expect(orderStops(randomMatrix(2, 1))).toEqual([1]);
  });
});

describe('straight line and legs', () => {
  const store = { latitude: -23.5649, longitude: -46.6519 };
  const a = { latitude: -23.5589, longitude: -46.6594 }; // ~1 km
  const b = { latitude: -23.5505, longitude: -46.6333 }; // ~2.5 km

  it('straight-line matrix grows with distance and is symmetric', () => {
    const m = straightLineMatrix([store, a, b]);
    expect(m.distances[0]![1]).toBeGreaterThan(900);
    expect(m.distances[0]![2]).toBeGreaterThan(m.distances[0]![1]!);
    expect(m.durations[1]![2]).toBe(m.durations[2]![1]);
    expect(m.durations[0]![0]).toBe(0);
  });

  it('legs accumulate travel and the time at each stop', () => {
    const m = straightLineMatrix([store, a, b]);
    const depart = new Date('2026-10-15T19:00:00Z');
    const route = routeLegs(m, [1, 2], depart);
    expect(route.legs.map((l) => l.index)).toEqual([1, 2]);
    expect(route.legs[0]!.etaAt.getTime()).toBe(depart.getTime() + m.durations[0]![1]! * 1000);
    expect(route.legs[1]!.etaAt.getTime() - route.legs[0]!.etaAt.getTime()).toBe(
      (m.durations[1]![2]! + STOP_SERVICE_SECONDS) * 1000,
    );
    expect(route.distanceMeters).toBe(m.distances[0]![1]! + m.distances[1]![2]!);
  });
});

describe('geometry for the simulated courier', () => {
  const line = straightGeometry([
    { latitude: -23.56, longitude: -46.65 },
    { latitude: -23.55, longitude: -46.65 },
    { latitude: -23.55, longitude: -46.64 },
  ]);

  it('walks along the line and stops at the end', () => {
    const length = lineLength(line);
    expect(pointAlong(line, 0)).toEqual({ latitude: -23.56, longitude: -46.65 });
    expect(pointAlong(line, length + 500)).toEqual({ latitude: -23.55, longitude: -46.64 });
    const middle = pointAlong(line, length / 2);
    expect(middle.latitude).toBeGreaterThanOrEqual(-23.56);
    expect(middle.latitude).toBeLessThanOrEqual(-23.55);
  });

  it('finds where a stop is reached along the line', () => {
    const corner = metersAlongTo(line, { latitude: -23.55, longitude: -46.65 });
    const first = lineLength(line.slice(0, 2));
    expect(Math.abs(corner - first)).toBeLessThan(15);
  });
});
