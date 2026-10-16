import { Injectable } from '@nestjs/common';
import { type CourierPositionEvent, type OrderEvent, REALTIME_EVENTS } from '@app/shared';
import {
  RealtimeGateway,
  deviceRoom,
  printAgentRoom,
  sectorRoom,
  dispatchRoom,
  tenantRoom,
} from './realtime.gateway.js';
import { TrackingGateway } from './tracking.gateway.js';

/**
 * Publishes realtime notifications. Call it AFTER the database transaction commits, so a
 * client that refetches on the event always sees the new state.
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly tracking: TrackingGateway,
  ) {}

  /** Public tracking page of one order (digital menu): status only. */
  trackingUpdated(token: string, payload: { status: string; version: number }): void {
    this.tracking.emit(token, REALTIME_EVENTS.TRACKING_UPDATED, payload);
  }

  orderCreated(tenantId: string, event: OrderEvent, sectorIds: string[] = []): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.ORDER_CREATED, event);
    for (const sectorId of new Set(sectorIds)) {
      this.gateway.emit(sectorRoom(tenantId, sectorId), REALTIME_EVENTS.ORDER_CREATED, event);
    }
  }

  orderUpdated(tenantId: string, event: OrderEvent, sectorIds: string[] = []): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.ORDER_UPDATED, event);
    for (const sectorId of new Set(sectorIds)) {
      this.gateway.emit(sectorRoom(tenantId, sectorId), REALTIME_EVENTS.ORDER_UPDATED, event);
    }
  }

  tablesUpdated(tenantId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.TABLES_UPDATED, {});
  }

  /** A cash register changed; clients refetch the register screen. */
  /** The manager revoked a KDS screen: it signs out right away. */
  deviceRevoked(deviceId: string): void {
    this.gateway.emit(deviceRoom(deviceId), REALTIME_EVENTS.DEVICE_REVOKED, {});
  }

  /** New print jobs for these agents (they lease them); the panel refreshes its queue. */
  printJobs(tenantId: string, agentIds: Iterable<string>): void {
    for (const id of new Set(agentIds)) {
      this.gateway.emit(printAgentRoom(id), REALTIME_EVENTS.PRINT_JOBS, {});
    }
    this.printingUpdated(tenantId);
  }

  printingUpdated(tenantId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.PRINTING_UPDATED, {});
  }

  /** Billing banner, read-only mode, modules or support session of a store changed (D042). */
  noticesUpdated(tenantId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.NOTICES_UPDATED, {});
  }

  /** The manager revoked a print agent: its socket is dropped (HTTP calls get 401). */
  printAgentRevoked(agentId: string): void {
    this.gateway.emit(printAgentRoom(agentId), REALTIME_EVENTS.DEVICE_REVOKED, {});
  }

  /** Where a courier is (dispatch map, D048): only to the unit's room, never to customers. */
  courierPosition(tenantId: string, event: CourierPositionEvent): void {
    this.gateway.emit(dispatchRoom(tenantId), REALTIME_EVENTS.COURIER_POSITION, event);
  }

  deliveryUpdated(tenantId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.DELIVERY_UPDATED, {});
  }

  cashUpdated(tenantId: string, sessionId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.CASH_UPDATED, { sessionId });
  }
}
