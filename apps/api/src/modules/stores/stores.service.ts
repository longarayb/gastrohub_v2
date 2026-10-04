import { Injectable } from '@nestjs/common';
import {
  type BusinessHour,
  type CreateStoreInput,
  type StoreSettingsInput,
  type UpdateStoreInput,
  isOpenAt,
  toLocalTime,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import {
  InjectStorage,
  type StorageProvider,
  type UploadedImage,
} from '../../core/storage/storage.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { AuthService } from '../auth/auth.service.js';
import type { Store } from '../../generated/prisma/client.js';

export function toStoreDto(store: Store) {
  return {
    id: store.id,
    slug: store.slug,
    tradeName: store.tradeName,
    legalName: store.legalName,
    cnpj: store.cnpj,
    phone: store.phone,
    email: store.email,
    logoUrl: store.logoUrl,
    timezone: store.timezone,
    address: {
      cep: store.addressCep ?? '',
      street: store.addressStreet ?? '',
      number: store.addressNumber ?? '',
      complement: store.addressComplement ?? '',
      neighborhood: store.addressNeighborhood ?? '',
      city: store.addressCity ?? '',
      state: store.addressState ?? '',
      reference: store.addressReference ?? '',
      latitude: store.latitude,
      longitude: store.longitude,
    },
    settings: {
      serviceFeeBps: store.serviceFeeBps,
      kdsLateAfterMinutes: store.kdsLateAfterMinutes,
      digitalMenuEnabled: store.digitalMenuEnabled,
      deliveryMinimumCents: store.deliveryMinimumCents,
      takeoutEtaMinutes: store.takeoutEtaMinutes,
      autoAcceptDigitalOrders: store.autoAcceptDigitalOrders,
    },
  };
}
export type StoreDto = ReturnType<typeof toStoreDto>;

@Injectable()
export class StoresService {
  constructor(
    // Store is the tenant itself (not a tenant-scoped model): always filtered by ctx.tenantId.
    private readonly prisma: PrismaService,
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    @InjectStorage() private readonly storage: StorageProvider,
  ) {}

  private async current(): Promise<Store> {
    const store = await this.prisma.store.findUnique({ where: { id: this.ctx.tenantId } });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  async getCurrent(): Promise<StoreDto> {
    return toStoreDto(await this.current());
  }

  async update(input: UpdateStoreInput & { cnpj: string; phone: string }): Promise<StoreDto> {
    const before = await this.current();
    if (input.slug !== before.slug) {
      const taken = await this.prisma.store.findUnique({ where: { slug: input.slug } });
      if (taken) throw new ConflictError('Este endereço do cardápio já está em uso');
    }
    const a = input.address;
    const store = await this.prisma.store.update({
      where: { id: before.id },
      data: {
        tradeName: input.tradeName,
        legalName: input.legalName,
        cnpj: input.cnpj,
        phone: input.phone,
        email: input.email ?? null,
        slug: input.slug,
        addressCep: a.cep,
        addressStreet: a.street,
        addressNumber: a.number,
        addressComplement: a.complement ?? '',
        addressNeighborhood: a.neighborhood,
        addressCity: a.city,
        addressState: a.state,
        addressReference: a.reference ?? '',
        latitude: a.latitude ?? before.latitude,
        longitude: a.longitude ?? before.longitude,
      },
    });
    await this.audit.log({
      action: AuditAction.STORE_UPDATED,
      entity: 'Store',
      entityId: store.id,
      before: toStoreDto(before),
      after: toStoreDto(store),
    });
    return toStoreDto(store);
  }

  async updateSettings(input: StoreSettingsInput): Promise<StoreDto> {
    const before = await this.current();
    const store = await this.prisma.store.update({ where: { id: before.id }, data: input });
    await this.audit.log({
      action: AuditAction.STORE_UPDATED,
      entity: 'Store',
      entityId: store.id,
      before: toStoreDto(before).settings,
      after: toStoreDto(store).settings,
    });
    return toStoreDto(store);
  }

  async updateLogo(file: UploadedImage): Promise<StoreDto> {
    const before = await this.current();
    const url = await this.storage.save(`stores/${before.id}`, file);
    const store = await this.prisma.store.update({
      where: { id: before.id },
      data: { logoUrl: url },
    });
    if (before.logoUrl) await this.storage.remove(before.logoUrl);
    return toStoreDto(store);
  }

  async getHours(): Promise<BusinessHour[]> {
    return this.db.businessHours.findMany({
      orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }],
      select: { weekday: true, opensAt: true, closesAt: true },
    });
  }

  async replaceHours(hours: BusinessHour[]): Promise<BusinessHour[]> {
    await this.db.$transaction(async (tx) => {
      await tx.businessHours.deleteMany({});
      if (hours.length) {
        await tx.businessHours.createMany({
          data: hours.map((h) => ({
            weekday: h.weekday,
            opensAt: h.opensAt,
            closesAt: h.closesAt,
          })),
        });
      }
    });
    return this.getHours();
  }

  async isOpenNow(now = new Date()): Promise<boolean> {
    const store = await this.current();
    const { weekday, minutes } = toLocalTime(now, store.timezone);
    return isOpenAt(await this.getHours(), weekday, minutes);
  }

  /** Creates a new unit in the same organization; the creator becomes its owner. */
  async createUnit(input: CreateStoreInput & { cnpj: string; phone: string }) {
    const current = await this.current();
    const slug = await this.auth.availableSlug(input.slug ?? input.tradeName);
    const userId = this.ctx.userId;
    const store = await this.prisma.store.create({
      data: {
        organizationId: current.organizationId,
        slug,
        tradeName: input.tradeName,
        legalName: input.legalName,
        cnpj: input.cnpj,
        phone: input.phone,
        memberships: userId ? { create: { userId, role: 'OWNER' } } : undefined,
        businessHours: {
          createMany: {
            data: Array.from({ length: 7 }, (_, weekday) => ({
              weekday,
              opensAt: '11:00',
              closesAt: '23:00',
            })),
          },
        },
      },
    });
    return toStoreDto(store);
  }
}
