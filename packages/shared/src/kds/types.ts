import type { ProductionTaskKind, ProductionTaskStatus, TaskDetails } from '../domain/kds.js';
import type { OrderSource, OrderStatus, OrderType } from '../domain/order-status.js';

/** Response DTOs of the kitchen display API. Dates are ISO strings. */

export interface KdsSectorDto {
  id: string;
  name: string;
  warnAfterMinutes: number;
  lateAfterMinutes: number;
}

export interface KdsTaskDto {
  id: string;
  orderItemId: string;
  kind: ProductionTaskKind;
  name: string;
  quantity: number;
  details: TaskDetails;
  status: ProductionTaskStatus;
  startedAt: string | null;
  readyAt: string | null;
  canceledAt: string | null;
  recallCount: number;
  /** The order item was already handed over (no more undo). */
  served: boolean;
}

/** A ticket is one round of one order in one sector. */
export interface KdsTicketDto {
  key: string;
  orderId: string;
  orderNumber: number;
  orderType: OrderType;
  orderStatus: OrderStatus;
  orderSource: OrderSource;
  orderVersion: number;
  title: string;
  roundId: string;
  roundNumber: number;
  sectorId: string;
  sentAt: string;
  /** Every active task ready: when the last one finished (null while there is work). */
  doneAt: string | null;
  /** Every task canceled (order or items canceled after sending). */
  canceled: boolean;
  tasks: KdsTaskDto[];
}

export interface KdsBoardDto {
  sectors: KdsSectorDto[];
  tickets: KdsTicketDto[];
  /** Server time, so the timers do not depend on the device clock. */
  serverTime: string;
}

export interface KdsExpeditionRoundDto {
  roundId: string;
  number: number;
  sentAt: string;
  sectors: { sectorId: string; name: string; total: number; ready: number }[];
  complete: boolean;
}

export interface KdsExpeditionOrderDto {
  orderId: string;
  number: number;
  type: OrderType;
  status: OrderStatus;
  version: number;
  title: string;
  courierId: string | null;
  courierName: string | null;
  rounds: KdsExpeditionRoundDto[];
  /** Every round complete: ready to leave. */
  complete: boolean;
}

export interface KdsExpeditionDto {
  orders: KdsExpeditionOrderDto[];
  couriers: { id: string; name: string }[];
  serverTime: string;
}

export interface KdsProductDto {
  id: string;
  name: string;
  sectorId: string | null;
  categoryName: string;
  paused: boolean;
  pausedUntil: string | null;
}

// ---- Devices ----

export type KdsDeviceState = 'PENDING' | 'PAIRED' | 'REVOKED';

export interface KdsDeviceDto {
  id: string;
  name: string;
  sectorIds: string[];
  showsExpedition: boolean;
  state: KdsDeviceState;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once, when a pairing code is generated (never stored in clear). */
export interface KdsPairingCodeDto {
  device: KdsDeviceDto;
  code: string;
  storeSlug: string;
  expiresAt: string;
}

/** What the tablet receives after pairing or renewing its session. */
export interface KdsDeviceSessionDto {
  accessToken: string;
  expiresIn: number;
  device: { id: string; name: string; sectorIds: string[]; showsExpedition: boolean };
  store: { id: string; name: string; slug: string };
}
