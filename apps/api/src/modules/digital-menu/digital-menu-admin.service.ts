import { Injectable } from '@nestjs/common';
import {
  type BlockedPhoneDto,
  type DigitalMenuSettingsDto,
  type blockedPhoneSchema,
  type digitalMenuSettingsSchema,
  formatCNPJ,
  formatPhone,
  privacyNoticeTemplate,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError } from '../../core/errors/domain-error.js';
import { AppConfig } from '../../core/config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { ImageService, type UploadedImage } from '../../core/storage/image.service.js';
import { type StorageProvider, InjectStorage } from '../../core/storage/storage.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Store } from '../../generated/prisma/client.js';

/** Digital menu settings (brand, receiving, limits, privacy) and blocked phones (panel). */
@Injectable()
export class DigitalMenuAdminService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) and user names are not tenant-scoped models.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly images: ImageService,
    @InjectStorage() private readonly storage: StorageProvider,
  ) {}

  private async storeRow(): Promise<Store> {
    const store = await this.prisma.store.findUnique({ where: { id: this.ctx.tenantId } });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  private toDto(store: Store): DigitalMenuSettingsDto {
    return {
      slug: store.slug,
      menuUrl: `${this.config.get('MENU_PUBLIC_URL')}/${store.slug}`,
      digitalMenuEnabled: store.digitalMenuEnabled,
      autoAcceptDigitalOrders: store.autoAcceptDigitalOrders,
      brandColor: store.brandColor,
      menuDescription: store.menuDescription,
      coverUrl: store.menuCoverKey ? this.storage.publicUrl(store.menuCoverKey) : null,
      privacyNotice: store.privacyNotice,
      privacyTemplate: privacyNoticeTemplate({
        name: store.tradeName,
        legalName: store.legalName,
        cnpj: store.cnpj ? formatCNPJ(store.cnpj) : null,
        email: store.email,
        phone: store.phone ? formatPhone(store.phone) : null,
      }),
      limitPerPhoneOpen: store.digitalLimitPhoneOpen,
      limitPerPhoneDay: store.digitalLimitPhoneDay,
      limitPerIpHour: store.digitalLimitIpHour,
      limitStorePending: store.digitalLimitStorePending,
    };
  }

  async settings(): Promise<DigitalMenuSettingsDto> {
    return this.toDto(await this.storeRow());
  }

  async updateSettings(
    input: z.output<typeof digitalMenuSettingsSchema>,
  ): Promise<DigitalMenuSettingsDto> {
    const before = await this.storeRow();
    const store = await this.prisma.store.update({
      where: { id: before.id },
      data: {
        digitalMenuEnabled: input.digitalMenuEnabled,
        autoAcceptDigitalOrders: input.autoAcceptDigitalOrders,
        brandColor: input.brandColor,
        menuDescription: input.menuDescription,
        privacyNotice: input.privacyNotice,
        digitalLimitPhoneOpen: input.limitPerPhoneOpen,
        digitalLimitPhoneDay: input.limitPerPhoneDay,
        digitalLimitIpHour: input.limitPerIpHour,
        digitalLimitStorePending: input.limitStorePending,
      },
    });
    await this.audit.log({
      action: AuditAction.DIGITAL_MENU_UPDATED,
      entity: 'Store',
      entityId: before.id,
      before: this.toDto(before),
      after: this.toDto(store),
    });
    return this.toDto(store);
  }

  async updateCover(file: UploadedImage): Promise<DigitalMenuSettingsDto> {
    const before = await this.storeRow();
    const key = await this.images.storeSingle(`t/${before.id}/menu-cover`, file);
    const store = await this.prisma.store.update({
      where: { id: before.id },
      data: { menuCoverKey: key },
    });
    if (before.menuCoverKey) await this.storage.delete(before.menuCoverKey);
    return this.toDto(store);
  }

  async removeCover(): Promise<DigitalMenuSettingsDto> {
    const before = await this.storeRow();
    const store = await this.prisma.store.update({
      where: { id: before.id },
      data: { menuCoverKey: null },
    });
    if (before.menuCoverKey) await this.storage.delete(before.menuCoverKey);
    return this.toDto(store);
  }

  async blockedPhones(): Promise<BlockedPhoneDto[]> {
    const rows = await this.db.blockedPhone.findMany({ orderBy: { createdAt: 'desc' } });
    const ids = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      reason: r.reason,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async blockPhone(input: z.output<typeof blockedPhoneSchema>): Promise<BlockedPhoneDto[]> {
    await this.db.blockedPhone.upsert({
      where: { tenantId_phone: { tenantId: this.ctx.tenantId, phone: input.phone } },
      create: { phone: input.phone, reason: input.reason, createdById: this.ctx.userId ?? null },
      update: { reason: input.reason },
    });
    await this.audit.log({
      action: AuditAction.PHONE_BLOCKED,
      entity: 'BlockedPhone',
      entityId: input.phone,
      reason: input.reason ?? undefined,
    });
    return this.blockedPhones();
  }

  async unblockPhone(id: string): Promise<BlockedPhoneDto[]> {
    const row = await this.db.blockedPhone.findFirst({ where: { id } });
    if (!row) throw new NotFoundError('Telefone bloqueado');
    await this.db.blockedPhone.delete({ where: { id } });
    await this.audit.log({
      action: AuditAction.PHONE_UNBLOCKED,
      entity: 'BlockedPhone',
      entityId: row.phone,
      before: { reason: row.reason },
    });
    return this.blockedPhones();
  }
}
