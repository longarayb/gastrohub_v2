import { Injectable } from '@nestjs/common';
import {
  type ModifierGroupData,
  type ModifierGroupDto,
  type PauseInput,
  Permission,
  hasPermission,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MenuContext, RESUMED, iso } from './menu-common.js';

const groupInclude = {
  options: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: {
      product: { select: { name: true, deletedAt: true } },
      sizePrices: { select: { sizeId: true, priceCents: true } },
    },
  },
  links: { select: { categoryId: true, productId: true, isDisabled: true } },
} satisfies Prisma.ModifierGroupInclude;

type GroupRow = Prisma.ModifierGroupGetPayload<{ include: typeof groupInclude }>;

const optionPrices = (g: GroupRow) =>
  Object.fromEntries(
    g.options.map((o) => [
      o.id,
      {
        name: o.product?.name ?? o.name,
        priceCents: o.priceCents,
        sizePrices: o.sizePrices
          .slice()
          .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
          .map((s) => [s.sizeId, s.priceCents]),
      },
    ]),
  );

@Injectable()
export class ModifierGroupsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly audit: AuditService,
  ) {}

  private toDto(g: GroupRow): ModifierGroupDto {
    const active = g.links.filter((l) => !l.isDisabled);
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        displayName: o.product?.name ?? o.name,
        priceCents: o.priceCents,
        maxQuantity: o.maxQuantity,
        sortOrder: o.sortOrder,
        productId: o.productId,
        isPaused: o.isPaused,
        pausedUntil: iso(o.pausedUntil),
        sku: o.sku,
        externalCode: o.externalCode,
        sizePrices: o.sizePrices,
      })),
      usage: {
        categories: active.filter((l) => l.categoryId).length,
        products: active.filter((l) => l.productId).length,
      },
    };
  }

  private async findRow(id: string, client: Db | DbTx = this.db): Promise<GroupRow> {
    const group = await client.modifierGroup.findFirst({
      where: { id, deletedAt: null },
      include: groupInclude,
    });
    if (!group) throw new NotFoundError('Grupo de complementos');
    return group;
  }

  async list(): Promise<ModifierGroupDto[]> {
    const groups = await this.db.modifierGroup.findMany({
      where: { deletedAt: null },
      include: groupInclude,
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => this.toDto(g));
  }

  async get(id: string): Promise<ModifierGroupDto> {
    return this.toDto(await this.findRow(id));
  }

  /** Validates combo products and size ids referenced by the options. */
  private async validateOptions(tx: DbTx, input: ModifierGroupData): Promise<void> {
    const productIds = [
      ...new Set(input.options.map((o) => o.productId).filter(Boolean)),
    ] as string[];
    if (productIds.length) {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, kind: true, category: { select: { kind: true } } },
      });
      if (products.length !== productIds.length) {
        throw new ValidationError('Produto do combo não encontrado');
      }
      if (products.some((p) => p.kind !== 'STANDARD' || p.category.kind !== 'STANDARD')) {
        throw new ValidationError(
          'Em combos, use produtos de preço único (sem tamanhos e que não sejam pizza)',
        );
      }
    }
    const sizeIds = [...new Set(input.options.flatMap((o) => o.sizePrices.map((s) => s.sizeId)))];
    if (sizeIds.length) {
      const found = await tx.size.count({ where: { id: { in: sizeIds } } });
      if (found !== sizeIds.length) throw new ValidationError('Tamanho não encontrado');
    }
  }

  private async syncOptions(tx: DbTx, groupId: string, input: ModifierGroupData): Promise<void> {
    const existing = await tx.modifierOption.findMany({
      where: { groupId, deletedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((o) => o.id));
    const keep = input.options.filter((o) => o.id).map((o) => o.id!);
    if (keep.some((id) => !existingIds.has(id))) {
      throw new ValidationError('Opção não pertence a este grupo');
    }
    // Removed options are soft-deleted (orders keep their snapshot anyway).
    await tx.modifierOption.updateMany({
      where: { groupId, deletedAt: null, id: { notIn: keep } },
      data: { deletedAt: new Date() },
    });

    for (const [sortOrder, option] of input.options.entries()) {
      const data = {
        name: option.name,
        priceCents: option.priceCents,
        maxQuantity: option.maxQuantity,
        productId: option.productId,
        sku: option.sku,
        externalCode: option.externalCode,
        sortOrder,
      };
      const optionId = option.id
        ? (await tx.modifierOption.update({ where: { id: option.id }, data })).id
        : (await tx.modifierOption.create({ data: { ...data, groupId } })).id;
      await tx.modifierOptionSizePrice.deleteMany({ where: { optionId } });
      if (option.sizePrices.length) {
        await tx.modifierOptionSizePrice.createMany({
          data: option.sizePrices.map((s) => ({ ...s, optionId })),
        });
      }
    }
  }

  async create(input: ModifierGroupData): Promise<ModifierGroupDto> {
    const id = await this.db.$transaction(async (tx) => {
      await this.validateOptions(tx, input);
      const group = await tx.modifierGroup.create({
        data: { name: input.name, description: input.description },
      });
      await this.syncOptions(tx, group.id, input);
      return group.id;
    });
    return this.get(id);
  }

  async update(id: string, input: ModifierGroupData): Promise<ModifierGroupDto> {
    await this.db.$transaction(async (tx) => {
      const before = await this.findRow(id, tx);
      await this.validateOptions(tx, input);
      await tx.modifierGroup.update({
        where: { id },
        data: { name: input.name, description: input.description },
      });
      await this.syncOptions(tx, id, input);

      const after = await this.findRow(id, tx);
      const oldPrices = optionPrices(before);
      const newPrices = optionPrices(after);
      // Only options that existed before and changed price count as price changes.
      const changed = Object.keys(oldPrices).filter(
        (optionId) =>
          newPrices[optionId] &&
          JSON.stringify({ ...oldPrices[optionId], name: '' }) !==
            JSON.stringify({ ...newPrices[optionId], name: '' }),
      );
      if (changed.length) {
        if (!hasPermission(this.ctx.role, Permission.PRICES_MANAGE)) {
          throw new ForbiddenError('Você não tem permissão para alterar preços');
        }
        await this.audit.log(
          {
            action: AuditAction.PRICE_CHANGED,
            entity: 'ModifierGroup',
            entityId: id,
            before: { group: before.name, options: changed.map((o) => oldPrices[o]) },
            after: { group: after.name, options: changed.map((o) => newPrices[o]) },
          },
          tx,
        );
      }
    });
    return this.get(id);
  }

  /** Soft delete; links to categories and products are removed. */
  async remove(id: string): Promise<void> {
    await this.findRow(id);
    await this.db.$transaction(async (tx) => {
      await tx.modifierGroupLink.deleteMany({ where: { groupId: id } });
      await tx.modifierGroup.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async setOptionPause(optionId: string, input: PauseInput | null): Promise<ModifierGroupDto> {
    const option = await this.db.modifierOption.findFirst({
      where: { id: optionId, deletedAt: null },
    });
    if (!option) throw new NotFoundError('Opção');
    const state = input ? await this.menu.pauseState(input) : RESUMED;
    await this.db.modifierOption.update({ where: { id: optionId }, data: state });
    return this.get(option.groupId);
  }
}
