/**
 * Dispatch with map and routes (docs/PROPOSTA_DISPATCH.md, D048): pure rules shared by the API,
 * the panel and the simulator. Times in seconds, distances in meters.
 */
import { type Coordinates, distanceMeters } from './delivery.js';

/** Travel matrix: durations[i][j] and distances[i][j], index 0 = the store. */
export interface TravelMatrix {
  durations: number[][];
  distances: number[][];
}

/**
 * Straight-line fallback (the routing service failed or is off): the crow-flies distance times a
 * detour factor, at a motorcycle's average city speed.
 */
export const STRAIGHT_LINE = { detourFactor: 1.35, speedKmh: 22 } as const;

export function straightLineMatrix(points: readonly Coordinates[]): TravelMatrix {
  const metersPerSecond = (STRAIGHT_LINE.speedKmh * 1000) / 3600;
  const distances = points.map((a) =>
    points.map((b) => Math.round(distanceMeters(a, b) * STRAIGHT_LINE.detourFactor)),
  );
  return {
    distances,
    durations: distances.map((row) => row.map((d) => Math.round(d / metersPerSecond))),
  };
}

/** Exact up to this many stops (Held-Karp); above it, nearest neighbor + 2-opt. */
export const EXACT_STOP_LIMIT = 10;

/**
 * Best order of the stops (indices 1..n of the matrix) leaving the store (index 0), minimizing
 * the time until the LAST delivery (the courier does not need to come back to deliver). Ties keep
 * the lower index first (stable). Returns the matrix indices of the stops in visiting order.
 */
export function orderStops(durations: readonly (readonly number[])[]): number[] {
  const n = durations.length - 1;
  if (n <= 0) return [];
  if (n === 1) return [1];
  return n <= EXACT_STOP_LIMIT
    ? heldKarp(durations, n)
    : twoOpt(durations, nearestNeighbor(durations, n));
}

function heldKarp(d: readonly (readonly number[])[], n: number): number[] {
  const full = 1 << n;
  // cost[mask][j]: best time from the store visiting exactly `mask`, ending at stop j (0-based).
  const cost = Array.from({ length: full }, () => new Array<number>(n).fill(Infinity));
  const parent = Array.from({ length: full }, () => new Array<number>(n).fill(-1));
  for (let j = 0; j < n; j++) cost[1 << j]![j] = d[0]![j + 1]!;
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      const here = cost[mask]![j]!;
      if (!(mask & (1 << j)) || here === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const value = here + d[j + 1]![k + 1]!;
        if (value < cost[next]![k]!) {
          cost[next]![k] = value;
          parent[next]![k] = j;
        }
      }
    }
  }
  let end = 0;
  for (let j = 1; j < n; j++) if (cost[full - 1]![j]! < cost[full - 1]![end]!) end = j;
  const order: number[] = [];
  let mask = full - 1;
  let at = end;
  while (at !== -1) {
    order.push(at + 1);
    const prev = parent[mask]![at]!;
    mask &= ~(1 << at);
    at = prev;
  }
  return order.reverse();
}

function nearestNeighbor(d: readonly (readonly number[])[], n: number): number[] {
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const order: number[] = [];
  let at = 0;
  while (left.size) {
    let best = -1;
    for (const k of left) if (best === -1 || d[at]![k]! < d[at]![best]!) best = k;
    order.push(best);
    left.delete(best);
    at = best;
  }
  return order;
}

/** Time of an open path from the store through `order`. */
export function pathDuration(d: readonly (readonly number[])[], order: readonly number[]): number {
  let total = 0;
  let at = 0;
  for (const k of order) {
    total += d[at]![k]!;
    at = k;
  }
  return total;
}

function twoOpt(d: readonly (readonly number[])[], start: number[]): number[] {
  let best = start;
  let bestTime = pathDuration(d, best);
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const time = pathDuration(d, candidate);
        if (time < bestTime - 1e-9) {
          best = candidate;
          bestTime = time;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Minutes the courier spends at each stop (parking, handing over, payment). */
export const STOP_SERVICE_SECONDS = 180;

export interface Leg {
  /** Matrix index of the stop. */
  index: number;
  distanceMeters: number;
  durationSeconds: number;
  /** Expected arrival at this stop. */
  etaAt: Date;
}

/** Legs of a route in the given order, from a departure time (service time between stops). */
export function routeLegs(
  matrix: TravelMatrix,
  order: readonly number[],
  departAt: Date,
): { legs: Leg[]; distanceMeters: number; durationSeconds: number } {
  let at = 0;
  let clock = departAt.getTime();
  let distance = 0;
  const legs: Leg[] = [];
  order.forEach((k, i) => {
    const duration = matrix.durations[at]![k]!;
    const meters = matrix.distances[at]![k]!;
    if (i > 0) clock += STOP_SERVICE_SECONDS * 1000;
    clock += duration * 1000;
    distance += meters;
    legs.push({
      index: k,
      distanceMeters: meters,
      durationSeconds: duration,
      etaAt: new Date(clock),
    });
    at = k;
  });
  return {
    legs,
    distanceMeters: distance,
    durationSeconds: Math.round((clock - departAt.getTime()) / 1000),
  };
}

/** [longitude, latitude] pairs, as GeoJSON and the routing services use. */
export type LineString = [number, number][];

/** Straight polyline through the points (when the routing service gives no geometry). */
export function straightGeometry(points: readonly Coordinates[]): LineString {
  return points.map((p) => [p.longitude, p.latitude]);
}

/** Length of a line in meters. */
export function lineLength(line: LineString): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += segment(line[i - 1]!, line[i]!);
  return total;
}

const segment = (a: [number, number], b: [number, number]) =>
  distanceMeters({ latitude: a[1], longitude: a[0] }, { latitude: b[1], longitude: b[0] });

/** Point at `meters` along the line (clamped to its ends); used by the simulated courier. */
export function pointAlong(line: LineString, meters: number): Coordinates {
  if (!line.length) throw new Error('empty line');
  let left = Math.max(0, meters);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const length = segment(a, b);
    if (left <= length && length > 0) {
      const t = left / length;
      return { longitude: a[0] + (b[0] - a[0]) * t, latitude: a[1] + (b[1] - a[1]) * t };
    }
    left -= length;
  }
  const last = line[line.length - 1]!;
  return { longitude: last[0], latitude: last[1] };
}

/** Meters along the line closest to a point (where a stop is reached by the simulator). */
export function metersAlongTo(line: LineString, target: Coordinates): number {
  let best = 0;
  let bestDistance = Infinity;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const length = segment(a, b);
    const steps = Math.max(1, Math.ceil(length / 10));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { longitude: a[0] + (b[0] - a[0]) * t, latitude: a[1] + (b[1] - a[1]) * t };
      const d = distanceMeters(p, target);
      if (d < bestDistance) {
        bestDistance = d;
        best = walked + length * t;
      }
    }
    walked += length;
  }
  return best;
}
