import { Injectable } from '@nestjs/common';
import { type OrderEvent, REALTIME_EVENTS } from '@app/shared';
import { RealtimeGateway, sectorRoom, tenantRoom } from './realtime.gateway.js';

/**
 * Publishes realtime notifications. Call it AFTER the database transaction commits, so a
 * client that refetches on the event always sees the new state.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

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
  cashUpdated(tenantId: string, sessionId: string): void {
    this.gateway.emit(tenantRoom(tenantId), REALTIME_EVENTS.CASH_UPDATED, { sessionId });
  }
}
