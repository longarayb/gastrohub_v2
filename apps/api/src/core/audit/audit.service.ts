import { Injectable, Logger } from '@nestjs/common';
import { type Db, type DbTx, InjectDb } from '../tenancy/db.provider.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export const AuditAction = {
  ORDER_CANCELED: 'order.canceled',
  ORDER_DISCOUNT: 'order.discount',
  ORDER_ITEM_DISCOUNT: 'order.item_discount',
  ORDER_ITEM_REMOVED: 'order.item_removed',
  ORDER_ITEM_CANCELED: 'order.item_canceled',
  SERVICE_FEE_REMOVED: 'order.service_fee_removed',
  SERVICE_FEE_RESTORED: 'order.service_fee_restored',
  PRICE_CHANGED: 'product.price_changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  STORE_UPDATED: 'store.updated',
  CASH_OPENED: 'cash.opened',
  CASH_CLOSED: 'cash.closed',
  CASH_REOPENED: 'cash.reopened',
  CASH_MOVEMENT: 'cash.movement',
  PAYMENT_REFUNDED: 'payment.refunded',
  ORDER_ITEMS_MOVED: 'order.items_moved',
  ORDER_TABLE_TRANSFERRED: 'order.table_transferred',
  TABLES_MERGED: 'tables.merged',
  TABLES_SPLIT: 'tables.split',
  TABLE_CHANGED: 'tables.table_changed',
  KDS_TASK_RECALLED: 'kds.task_recalled',
  KDS_DEVICE_CREATED: 'kds.device_created',
  KDS_DEVICE_UPDATED: 'kds.device_updated',
  KDS_PAIRING_CODE: 'kds.pairing_code',
  KDS_DEVICE_PAIRED: 'kds.device_paired',
  KDS_PAIRING_FAILED: 'kds.pairing_failed',
  KDS_DEVICE_REVOKED: 'kds.device_revoked',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Writes the audit trail for sensitive operations. Pass `tx` to record inside a transaction. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
  ) {}

  async log(entry: AuditEntry, tx?: DbTx): Promise<void> {
    const client = tx ?? this.db;
    await client.auditLog.create({
      data: {
        tenantId: this.ctx.tenantId,
        userId: this.ctx.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        reason: entry.reason ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
      },
    });
    this.logger.log({ ...entry, userId: this.ctx.userId }, entry.action);
  }
}
