import type { OrderSummaryDto } from '../orders/types.js';
import type { LineString } from '../domain/dispatch.js';

/** Where coordinates came from (D048). */
export type GeoSource = 'GEOCODER' | 'MANUAL' | 'EXTERNAL';
/** HOUSE: the house itself; STREET: only the street was found (check the pin). */
export type GeoPrecision = 'HOUSE' | 'STREET';
/** OSRM or the straight-line fallback (routing off or failed). */
export type RouteSource = 'OSRM' | 'STRAIGHT';

export interface GeoPointDto {
  latitude: number;
  longitude: number;
}

export interface DispatchLocationDto extends GeoPointDto {
  source: GeoSource | null;
  precision: GeoPrecision | null;
}

/** A delivery order on the dispatch map (the kanban summary plus where it goes). */
export interface DispatchOrderDto extends OrderSummaryDto {
  /** "Rua X, 123 · complemento", without the customer's name. */
  addressLine: string;
  location: DispatchLocationDto | null;
  /** Without coordinates and still being located (geocoding queue). */
  locating: boolean;
}

export type DispatchStopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export interface DispatchStopDto {
  orderId: string;
  number: number;
  sequence: number;
  status: DispatchStopStatus;
  etaAt: string | null;
  location: GeoPointDto | null;
}

export interface CourierPositionDto extends GeoPointDto {
  recordedAt: string;
  simulated: boolean;
}

export interface DispatchRunDto {
  id: string;
  departedAt: string;
  stops: DispatchStopDto[];
  geometry: LineString | null;
  routeSource: RouteSource | null;
  distanceMeters: number | null;
  position: CourierPositionDto | null;
  /** The simulated courier is walking this run now. */
  simulating: boolean;
}

export interface DispatchCourierDto {
  id: string;
  name: string;
  /** Tests and the public demo: always shown as "simulado". */
  simulated: boolean;
  status: 'FREE' | 'OUT';
  run: DispatchRunDto | null;
}

export interface DispatchBoardDto {
  store: { name: string; location: GeoPointDto | null };
  /** Delivery orders being prepared, ready, or back after a failed attempt. */
  orders: DispatchOrderDto[];
  couriers: DispatchCourierDto[];
  routing: RouteSource;
  /** "Simular entregador" available (development, home server, public demo). */
  simulationAllowed: boolean;
  serverTime: string;
}

export interface RouteLegDto {
  orderId: string;
  distanceMeters: number;
  durationSeconds: number;
  etaAt: string;
}

export interface RouteSuggestionDto {
  /** Order ids in the suggested (or kept) order. */
  orderIds: string[];
  legs: RouteLegDto[];
  distanceMeters: number;
  durationSeconds: number;
  geometry: LineString;
  source: RouteSource;
  /** The routing service failed: straight-line estimate and order by distance. */
  fallback: boolean;
}

/** Realtime: where a courier is (only during an open run). */
export interface CourierPositionEvent extends CourierPositionDto {
  courierId: string;
  runId: string;
}

export interface OrderLocationResultDto {
  location: DispatchLocationDto;
  /** The new point falls outside the order's delivery area (the fee already charged stays). */
  outsideArea: string | null;
  savedToCustomer: boolean;
}
