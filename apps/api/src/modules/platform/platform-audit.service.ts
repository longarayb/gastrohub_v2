import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PlatformActor } from './platform.keys.js';

export const PlatformAuditAction = {
  LOGIN_PASSWORD_FAILED: 'auth.password_failed',
  LOGIN_LOCKED: 'auth.locked',
  LOGIN_TOTP_FAILED: 'auth.totp_failed',
  LOGIN_SUCCEEDED: 'auth.login',
  LOGIN_RECOVERY_CODE: 'auth.recovery_code_used',
  LOGOUT: 'auth.logout',
  TOTP_ENROLLED: 'auth.totp_enrolled',
  TOTP_RESET_EMERGENCY: 'auth.totp_reset_emergency',
  RECOVERY_CODES_REGENERATED: 'auth.recovery_codes_regenerated',
  PASSWORD_CHANGED: 'auth.password_changed',
  PASSWORD_RESET_SERVER: 'auth.password_reset_server',
  LOGIN_TEMP_PASSWORD_EXPIRED: 'auth.temporary_password_expired',
  ADMIN_CREATED: 'admin.created',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DISABLED: 'customer.disabled',
  CUSTOMER_ENABLED: 'customer.enabled',
  INVITE_SENT: 'customer.invite_sent',
  INVITE_LINK_CREATED: 'customer.invite_link_created',
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_PLAN_CHANGED: 'subscription.plan_changed',
  SUBSCRIPTION_PRICE_CHANGED: 'subscription.price_changed',
  SUBSCRIPTION_TRIAL_CHANGED: 'subscription.trial_changed',
  SUBSCRIPTION_GRACE_CHANGED: 'subscription.grace_changed',
  SUBSCRIPTION_SUSPENDED: 'subscription.suspended',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivated',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  INVOICES_GENERATED: 'invoice.generated',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_CANCELED: 'invoice.canceled',
  SETTINGS_UPDATED: 'settings.updated',
  SUPPORT_STARTED: 'support.started',
  SUPPORT_ENDED: 'support.ended',
} as const;
export type PlatformAuditAction = (typeof PlatformAuditAction)[keyof typeof PlatformAuditAction];

export interface PlatformAuditEntry {
  action: PlatformAuditAction;
  entity: string;
  entityId?: string | null;
  organizationId?: string | null;
  storeId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined || v === null
    ? undefined
    : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Platform audit trail (D041): every admin action, logins included. Append-only in the
 * database (trigger). Pass `tx` to record inside the same transaction as the change.
 */
@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger('PlatformAudit');

  constructor(private readonly prisma: PrismaService) {}

  async log(
    entry: PlatformAuditEntry,
    actor: PlatformActor,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).platformAuditLog.create({
      data: {
        adminId: actor.adminId,
        actorEmail: actor.email ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        organizationId: entry.organizationId ?? null,
        storeId: entry.storeId ?? null,
        reason: entry.reason ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
    });
    this.logger.log(
      { action: entry.action, adminId: actor.adminId, entityId: entry.entityId },
      entry.action,
    );
  }
}
