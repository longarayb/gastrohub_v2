import { randomBytes, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  KDS_DEVICE_ROLE,
  KDS_DEVICE_TTL_DAYS,
  KDS_PAIRING_CODE_LENGTH,
  KDS_PAIRING_MAX_FAILURES,
  KDS_PAIRING_TTL_MINUTES,
  type KdsDeviceDto,
  type KdsDeviceSessionDto,
  type KdsPairingCodeDto,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  DomainError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { KdsDevice } from '../../generated/prisma/client.js';
import { TokenService, sha256 } from '../auth/token.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Failed pairing attempts of one store within the window that block new attempts. */
export const STORE_PAIRING_FAILURE_LIMIT = 20;
const STORE_PAIRING_WINDOW_MINUTES = 15;
const INVALID_CODE = 'Código inválido ou expirado. Peça um novo código ao gerente.';

class TooManyAttemptsError extends DomainError {
  constructor() {
    super(
      'Muitas tentativas de vínculo nesta unidade. Aguarde alguns minutos e peça um novo código.',
      ErrorCode.RATE_LIMITED,
      429,
    );
  }
}

export interface DeviceCredential {
  token: string;
  expiresAt: Date;
}

function toDto(d: KdsDevice): KdsDeviceDto {
  return {
    id: d.id,
    name: d.name,
    sectorIds: d.sectorIds,
    showsExpedition: d.showsExpedition,
    state: d.revokedAt ? 'REVOKED' : d.tokenHash ? 'PAIRED' : 'PENDING',
    pairingExpiresAt:
      d.pairingCodeHash && d.pairingExpiresAt ? d.pairingExpiresAt.toISOString() : null,
    pairedAt: d.pairedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    revokedAt: d.revokedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Only the pairing code of one store is compared (store + code avoid cross-store guessing). */
const codeHash = (tenantId: string, code: string) => sha256(`${tenantId}:${code}`);

/**
 * KDS devices (docs/DECISOES.md D028): a manager creates a screen bound to sectors and gets a
 * 6-digit code; the tablet pairs with store + code and receives a long-lived credential in an
 * httpOnly cookie, exchanged for short access tokens with the KDS_DEVICE role. Wrong codes
 * count per device (invalidated after 5) and per store (blocked for a while), and are audited.
 */
@Injectable()
export class KdsDevicesService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Pairing and session renewal are public: the store comes from the slug or the device.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Management (store:manage)

  async list(): Promise<KdsDeviceDto[]> {
    const devices = await this.db.kdsDevice.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return devices.map(toDto);
  }

  private async validSectors(sectorIds: string[]): Promise<string[]> {
    const found = await this.db.productionSector.count({ where: { id: { in: sectorIds } } });
    if (found !== sectorIds.length) throw new ValidationError('Setor não encontrado');
    return sectorIds;
  }

  private newCode() {
    const code = String(randomInt(0, 10 ** KDS_PAIRING_CODE_LENGTH)).padStart(
      KDS_PAIRING_CODE_LENGTH,
      '0',
    );
    return {
      code,
      expiresAt: new Date(Date.now() + KDS_PAIRING_TTL_MINUTES * 60_000),
    };
  }

  private async storeSlug(): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { slug: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store.slug;
  }

  async create(input: {
    name: string;
    sectorIds: string[];
    showsExpedition: boolean;
  }): Promise<KdsPairingCodeDto> {
    const sectorIds = await this.validSectors(input.sectorIds);
    const { code, expiresAt } = this.newCode();
    const device = await this.db.kdsDevice.create({
      data: {
        name: input.name,
        sectorIds,
        showsExpedition: input.showsExpedition,
        pairingCodeHash: codeHash(this.ctx.tenantId, code),
        pairingExpiresAt: expiresAt,
        createdById: this.ctx.userId!,
      },
    });
    await this.audit.log({
      action: AuditAction.KDS_DEVICE_CREATED,
      entity: 'KdsDevice',
      entityId: device.id,
      after: { name: device.name, sectorIds, showsExpedition: input.showsExpedition },
    });
    return {
      device: toDto(device),
      code,
      storeSlug: await this.storeSlug(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name: string; sectorIds: string[]; showsExpedition: boolean },
  ): Promise<KdsDeviceDto> {
    const current = await this.db.kdsDevice.findFirst({ where: { id } });
    if (!current) throw new NotFoundError('Tela');
    const device = await this.db.kdsDevice.update({
      where: { id },
      data: {
        name: input.name,
        sectorIds: await this.validSectors(input.sectorIds),
        showsExpedition: input.showsExpedition,
      },
    });
    await this.audit.log({
      action: AuditAction.KDS_DEVICE_UPDATED,
      entity: 'KdsDevice',
      entityId: id,
      before: {
        name: current.name,
        sectorIds: current.sectorIds,
        showsExpedition: current.showsExpedition,
      },
      after: {
        name: device.name,
        sectorIds: device.sectorIds,
        showsExpedition: device.showsExpedition,
      },
    });
    return toDto(device);
  }

  /** New code (first pairing, or moving the screen to another tablet). */
  async pairingCode(id: string): Promise<KdsPairingCodeDto> {
    const current = await this.db.kdsDevice.findFirst({ where: { id } });
    if (!current) throw new NotFoundError('Tela');
    if (current.revokedAt) throw new ValidationError('Esta tela foi desvinculada; crie outra');
    const { code, expiresAt } = this.newCode();
    const device = await this.db.kdsDevice.update({
      where: { id },
      data: {
        pairingCodeHash: codeHash(this.ctx.tenantId, code),
        pairingExpiresAt: expiresAt,
        pairingFailures: 0,
      },
    });
    await this.audit.log({
      action: AuditAction.KDS_PAIRING_CODE,
      entity: 'KdsDevice',
      entityId: id,
    });
    return {
      device: toDto(device),
      code,
      storeSlug: await this.storeSlug(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Revoked screens lose access right away (guard check and realtime notice). */
  async revoke(id: string): Promise<KdsDeviceDto> {
    const current = await this.db.kdsDevice.findFirst({ where: { id } });
    if (!current) throw new NotFoundError('Tela');
    const device = await this.db.kdsDevice.update({
      where: { id },
      data: {
        revokedAt: current.revokedAt ?? new Date(),
        revokedById: current.revokedById ?? this.ctx.userId ?? null,
        tokenHash: null,
        tokenExpiresAt: null,
        pairingCodeHash: null,
        pairingExpiresAt: null,
      },
    });
    await this.audit.log({
      action: AuditAction.KDS_DEVICE_REVOKED,
      entity: 'KdsDevice',
      entityId: id,
      before: { name: current.name, pairedAt: current.pairedAt },
    });
    this.realtime.deviceRevoked(id);
    return toDto(device);
  }

  // ---------------------------------------------------------------------------
  // Tablet side (public: store slug + code, then the device cookie)

  private async issueCredential(deviceId: string): Promise<DeviceCredential> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + KDS_DEVICE_TTL_DAYS * 86_400_000);
    await this.prisma.kdsDevice.update({
      where: { id: deviceId },
      data: { tokenHash: sha256(token), tokenExpiresAt: expiresAt, lastSeenAt: new Date() },
    });
    return { token, expiresAt };
  }

  private async session(device: KdsDevice): Promise<KdsDeviceSessionDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: device.tenantId },
      select: { id: true, tradeName: true, slug: true },
    });
    if (!store) throw new UnauthorizedError();
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: device.id,
        tenantId: device.tenantId,
        role: KDS_DEVICE_ROLE,
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      device: {
        id: device.id,
        name: device.name,
        sectorIds: device.sectorIds,
        showsExpedition: device.showsExpedition,
      },
      store: { id: store.id, name: store.tradeName, slug: store.slug },
    };
  }

  private async auditFailure(tenantId: string, ip: string | undefined): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        action: AuditAction.KDS_PAIRING_FAILED,
        entity: 'KdsDevice',
        after: { ip: ip ?? null },
      },
    });
  }

  async pair(
    input: { store: string; code: string },
    meta: { ip?: string },
  ): Promise<{ session: KdsDeviceSessionDto; credential: DeviceCredential }> {
    const store = await this.prisma.store.findUnique({
      where: { slug: input.store },
      select: { id: true },
    });
    // Unknown store: same answer as a wrong code (nothing to learn by guessing slugs).
    if (!store) throw new ValidationError(INVALID_CODE);
    const tenantId = store.id;
    const now = new Date();
    const recentFailures = await this.prisma.auditLog.count({
      where: {
        tenantId,
        action: AuditAction.KDS_PAIRING_FAILED,
        createdAt: { gte: new Date(now.getTime() - STORE_PAIRING_WINDOW_MINUTES * 60_000) },
      },
    });
    if (recentFailures >= STORE_PAIRING_FAILURE_LIMIT) throw new TooManyAttemptsError();

    const pending = await this.prisma.kdsDevice.findMany({
      where: {
        tenantId,
        revokedAt: null,
        pairingCodeHash: { not: null },
        pairingExpiresAt: { gt: now },
      },
    });
    const hash = codeHash(tenantId, input.code);
    const device = pending.find((d) => d.pairingCodeHash === hash);
    if (!device) {
      await this.auditFailure(tenantId, meta.ip);
      // Every pending code of the store counts the failure; 5 failures invalidate it.
      for (const d of pending) {
        const failures = d.pairingFailures + 1;
        await this.prisma.kdsDevice.update({
          where: { id: d.id },
          data:
            failures >= KDS_PAIRING_MAX_FAILURES
              ? { pairingFailures: failures, pairingCodeHash: null, pairingExpiresAt: null }
              : { pairingFailures: failures },
        });
      }
      throw new ValidationError(INVALID_CODE);
    }

    // Single use: the code is cleared in the same update that checks it.
    const { count } = await this.prisma.kdsDevice.updateMany({
      where: { id: device.id, pairingCodeHash: hash },
      data: { pairingCodeHash: null, pairingExpiresAt: null, pairingFailures: 0, pairedAt: now },
    });
    if (count === 0) throw new ValidationError(INVALID_CODE);
    const credential = await this.issueCredential(device.id);
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        action: AuditAction.KDS_DEVICE_PAIRED,
        entity: 'KdsDevice',
        entityId: device.id,
        after: { ip: meta.ip ?? null },
      },
    });
    return { session: await this.session(device), credential };
  }

  /** Exchanges the device cookie for an access token and renews the credential (180 days). */
  async renew(
    token: string | undefined,
  ): Promise<{ session: KdsDeviceSessionDto; credential: DeviceCredential }> {
    if (!token) throw new UnauthorizedError('Esta tela não está vinculada');
    const device = await this.prisma.kdsDevice.findUnique({ where: { tokenHash: sha256(token) } });
    if (
      !device ||
      device.revokedAt ||
      !device.tokenExpiresAt ||
      device.tokenExpiresAt < new Date()
    ) {
      throw new UnauthorizedError('Esta tela não está vinculada');
    }
    const credential = await this.issueCredential(device.id);
    return { session: await this.session(device), credential };
  }

  /** The tablet leaves (e.g. it will be used elsewhere): the credential stops working. */
  async unpair(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.kdsDevice.updateMany({
      where: { tokenHash: sha256(token) },
      data: { tokenHash: null, tokenExpiresAt: null },
    });
  }
}
