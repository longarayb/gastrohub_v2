import { Injectable } from '@nestjs/common';
import {
  type FlavorPriceDto,
  type PauseInput,
  Permission,
  type ProductData,
  type ProductDetailDto,
  type ProductListItemDto,
  type ProductListQuery,
  type SalesChannel,
  hasPermission,
  normalizeSearch,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { ImageService, type UploadedImage } from '../../core/storage/image.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { Prisma } from '../../generated/prisma/client.js';
import { assertGroupsExist } from './categories.service.js';
import {
  MenuContext,
  type PauseState,
  RESUMED,
  applyOrder,
  buildSearchText,
  iso,
  priceRange,
} from './menu-common.js';
import { findFirstSequential } from '../../core/prisma/sequential.js';

const productInclude = {
  category: { select: { id: true, name: true, kind: true, deletedAt: true } },
  sector: { select: { name: true } },
  sizes: { orderBy: { sortOrder: 'asc' }, include: { prices: true } },
  sizePrices: { include: { size: true } },
  schedules: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] },
  modifierLinks: { orderBy: { sortOrder: 'asc' }, include: { group: { select: { name: true } } } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** Prices of a product in a comparable shape (audit trail of price changes). */
function priceSnapshot(p: ProductRow) {
  const sizes = Object.fromEntries(
    p.sizePrices
      .slice()
      .sort((a, b) => a.size.sortOrder - b.size.sortOrder)
      .map((sp) => [
        sp.size.name,
        { priceCents: sp.priceCents, promoPriceCents: sp.promoPriceCents },
      ]),
  );
  return { priceCents: p.priceCents, promoPriceCents: p.promoPriceCents, sizes };
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly audit: AuditService,
    private readonly images: ImageService,
  ) {}

  // ---------------------------------------------------------------------------
  // Mapping

  private tags(p: ProductRow) {
    if (p.priceCents != null) {
      return [{ priceCents: p.priceCents, promoPriceCents: p.promoPriceCents }];
    }
    return p.sizePrices.map((sp) => ({
      priceCents: sp.priceCents,
      promoPriceCents: sp.promoPriceCents,
    }));
  }

  private toListItem(p: ProductRow): ProductListItemDto {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      categoryName: p.category.name,
      categoryKind: p.category.kind,
      kind: p.kind,
      sku: p.sku,
      sectorId: p.sectorId,
      sectorName: p.sector?.name ?? null,
      thumbUrl: this.images.url(p.thumbKey),
      price: priceRange(this.tags(p)),
      isPaused: p.isPaused,
      pausedUntil: iso(p.pausedUntil),
      channels: p.channels as SalesChannel[],
      sortOrder: p.sortOrder,
    };
  }

  private toDetail(p: ProductRow): ProductDetailDto {
    const flavorPrices: FlavorPriceDto[] =
      p.category.kind === 'PIZZA'
        ? p.sizePrices
            .slice()
            .sort((a, b) => a.size.sortOrder - b.size.sortOrder)
            .map((sp) => ({
              sizeId: sp.sizeId,
              sizeName: sp.size.name,
              priceCents: sp.priceCents,
              promoPriceCents: sp.promoPriceCents,
              isPaused: sp.isPaused,
              pausedUntil: iso(sp.pausedUntil),
            }))
        : [];
    return {
      ...this.toListItem(p),
      imageUrl: this.images.url(p.imageKey),
      priceCents: p.priceCents,
      promoPriceCents: p.promoPriceCents,
      externalCode: p.externalCode,
      schedules: p.schedules.map((s) => ({
        weekday: s.weekday,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
      })),
      sizes: p.sizes.map((s) => {
        const price = s.prices.find((sp) => sp.productId === p.id);
        return {
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          priceCents: price?.priceCents ?? 0,
          promoPriceCents: price?.promoPriceCents ?? null,
          isPaused: price?.isPaused ?? false,
          pausedUntil: iso(price?.pausedUntil),
          externalCode: s.externalCode,
        };
      }),
      flavorPrices,
      modifierLinks: p.modifierLinks.map((l) => ({
        groupId: l.groupId,
        groupName: l.group.name,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
        sortOrder: l.sortOrder,
        isDisabled: l.isDisabled,
      })),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async findRow(id: string, client: Db | DbTx = this.db): Promise<ProductRow> {
    const product = await findFirstSequential<ProductRow>(client.product, {
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new NotFoundError('Produto');
    return product;
  }

  // ---------------------------------------------------------------------------
  // Queries

  async list(query: ProductListQuery & { status: 'all' | 'active' | 'paused' }) {
    const now = new Date();
    const pausedNow: Prisma.ProductWhereInput = {
      isPaused: true,
      OR: [{ pausedUntil: null }, { pausedUntil: { gt: now } }],
    };
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      category: { deletedAt: null },
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.sectorId && { sectorId: query.sectorId }),
      ...(query.channel && { channels: { has: query.channel } }),
      ...(query.q && { searchText: { contains: normalizeSearch(query.q) } }),
      ...(query.status === 'paused' && pausedNow),
      ...(query.status === 'active' && { NOT: pausedNow }),
    };
    const products = await this.db.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
    return products.map((p) => this.toListItem(p));
  }

  async get(id: string): Promise<ProductDetailDto> {
    return this.toDetail(await this.findRow(id));
  }

  // ---------------------------------------------------------------------------
  // Writes

  /** Validates category-dependent pricing rules and references. */
  private async validate(tx: DbTx, input: ProductData) {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, deletedAt: null },
      include: { sizes: true },
    });
    if (!category) throw new ValidationError('Categoria não encontrada');

    if (input.sectorId) {
      const sector = await tx.productionSector.findUnique({ where: { id: input.sectorId } });
      if (!sector) throw new ValidationError('Setor de produção não encontrado');
    }
    await assertGroupsExist(
      tx,
      input.modifierLinks.map((l) => l.groupId),
    );

    if (category.kind === 'PIZZA') {
      const sizeIds = new Set(category.sizes.map((s) => s.id));
      if (sizeIds.size === 0) {
        throw new ValidationError('Cadastre os tamanhos da categoria de pizza antes dos sabores');
      }
      const priced = new Set(input.flavorPrices.map((f) => f.sizeId));
      if (
        input.flavorPrices.some((f) => !sizeIds.has(f.sizeId)) ||
        priced.size !== input.flavorPrices.length
      ) {
        throw new ValidationError('Preço informado para um tamanho que não pertence à categoria');
      }
      if ([...sizeIds].some((sizeId) => !priced.has(sizeId))) {
        throw new ValidationError('Informe o preço do sabor em todos os tamanhos');
      }
      if (input.modifierLinks.length) {
        throw new ValidationError(
          'Em pizzas, os complementos (ex.: borda) são vinculados à categoria, não ao sabor',
        );
      }
      return { category, kind: 'STANDARD' as const };
    }

    if (input.kind === 'SIZED') {
      if (input.sizes.length === 0) throw new ValidationError('Cadastre pelo menos um tamanho');
      return { category, kind: 'SIZED' as const };
    }
    if (input.priceCents == null) throw new ValidationError('Informe o preço do produto');
    return { category, kind: 'STANDARD' as const };
  }

  private async writeNested(
    tx: DbTx,
    productId: string,
    input: ProductData,
    categoryKind: 'STANDARD' | 'PIZZA',
    kind: 'STANDARD' | 'SIZED',
  ) {
    // Schedules and modifier links: replace.
    await tx.availabilitySchedule.deleteMany({ where: { productId } });
    if (input.schedules.length) {
      await tx.availabilitySchedule.createMany({
        data: input.schedules.map((s) => ({ ...s, productId })),
      });
    }
    await tx.modifierGroupLink.deleteMany({ where: { productId } });
    if (input.modifierLinks.length) {
      await tx.modifierGroupLink.createMany({
        data: input.modifierLinks.map((l, sortOrder) => ({ ...l, productId, sortOrder })),
      });
    }

    // Own sizes (SIZED): sync by id, keeping the pause state of existing prices.
    const ownSizes = await tx.size.findMany({ where: { productId } });
    const keep = kind === 'SIZED' ? input.sizes.filter((s) => s.id).map((s) => s.id!) : [];
    if (keep.some((id) => !ownSizes.some((s) => s.id === id))) {
      throw new ValidationError('Tamanho não pertence a este produto');
    }
    await tx.size.deleteMany({ where: { productId, id: { notIn: keep } } });

    if (kind === 'SIZED') {
      for (const [sortOrder, size] of input.sizes.entries()) {
        const sizeData = { name: size.name, externalCode: size.externalCode ?? null, sortOrder };
        const sizeId = size.id
          ? (await tx.size.update({ where: { id: size.id }, data: sizeData })).id
          : (await tx.size.create({ data: { ...sizeData, productId } })).id;
        await tx.productSizePrice.upsert({
          where: { productId_sizeId: { productId, sizeId } },
          create: {
            productId,
            sizeId,
            priceCents: size.priceCents,
            promoPriceCents: size.promoPriceCents,
          },
          update: { priceCents: size.priceCents, promoPriceCents: size.promoPriceCents },
        });
      }
    }

    // Pizza flavor prices for the category sizes.
    if (categoryKind === 'PIZZA') {
      const sizeIds = input.flavorPrices.map((f) => f.sizeId);
      await tx.productSizePrice.deleteMany({ where: { productId, sizeId: { notIn: sizeIds } } });
      for (const f of input.flavorPrices) {
        await tx.productSizePrice.upsert({
          where: { productId_sizeId: { productId, sizeId: f.sizeId } },
          create: {
            productId,
            sizeId: f.sizeId,
            priceCents: f.priceCents,
            promoPriceCents: f.promoPriceCents,
          },
          update: { priceCents: f.priceCents, promoPriceCents: f.promoPriceCents },
        });
      }
    } else if (kind === 'STANDARD') {
      await tx.productSizePrice.deleteMany({ where: { productId } });
    }
  }

  private baseData(
    input: ProductData,
    categoryKind: 'STANDARD' | 'PIZZA',
    kind: 'STANDARD' | 'SIZED',
  ) {
    const singlePrice = categoryKind === 'STANDARD' && kind === 'STANDARD';
    return {
      categoryId: input.categoryId,
      kind,
      name: input.name,
      description: input.description,
      priceCents: singlePrice ? input.priceCents : null,
      promoPriceCents: singlePrice ? input.promoPriceCents : null,
      sku: input.sku,
      externalCode: input.externalCode,
      sectorId: input.sectorId,
      channels: input.channels,
      searchText: buildSearchText(input.name, input.sku, input.description),
    };
  }

  private skuConflict<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Este código interno já está em uso por outro produto');
      }
      throw error;
    });
  }

  async create(input: ProductData): Promise<ProductDetailDto> {
    const id = await this.skuConflict(
      this.db.$transaction(async (tx) => {
        const { category, kind } = await this.validate(tx, input);
        const last = await tx.product.findFirst({
          where: { categoryId: category.id, deletedAt: null },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        const product = await tx.product.create({
          data: {
            ...this.baseData(input, category.kind, kind),
            sortOrder: (last?.sortOrder ?? -1) + 1,
          },
        });
        await this.writeNested(tx, product.id, input, category.kind, kind);
        return product.id;
      }),
    );
    return this.get(id);
  }

  async update(id: string, input: ProductData): Promise<ProductDetailDto> {
    await this.skuConflict(
      this.db.$transaction(async (tx) => {
        const before = await this.findRow(id, tx);
        const { category, kind } = await this.validate(tx, input);
        const movedCategory = before.categoryId !== category.id;
        let sortOrder = before.sortOrder;
        if (movedCategory) {
          const last = await tx.product.findFirst({
            where: { categoryId: category.id, deletedAt: null },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
          });
          sortOrder = (last?.sortOrder ?? -1) + 1;
        }
        await tx.product.update({
          where: { id },
          data: { ...this.baseData(input, category.kind, kind), sortOrder },
        });
        await this.writeNested(tx, id, input, category.kind, kind);

        // Price history: every change goes to the audit trail (and requires permission).
        const after = await this.findRow(id, tx);
        const oldPrices = priceSnapshot(before);
        const newPrices = priceSnapshot(after);
        if (JSON.stringify(oldPrices) !== JSON.stringify(newPrices)) {
          if (!hasPermission(this.ctx.role, Permission.PRICES_MANAGE)) {
            throw new ForbiddenError('Você não tem permissão para alterar preços');
          }
          await this.audit.log(
            {
              action: AuditAction.PRICE_CHANGED,
              entity: 'Product',
              entityId: id,
              before: { name: before.name, ...oldPrices },
              after: { name: after.name, ...newPrices },
            },
            tx,
          );
        }
      }),
    );
    return this.get(id);
  }

  /** Soft delete; the internal code is released for reuse. */
  async remove(id: string): Promise<void> {
    await this.findRow(id);
    await this.db.product.update({ where: { id }, data: { deletedAt: new Date(), sku: null } });
  }

  /** Copies a product (sizes, prices, links, schedules, image). The copy starts paused. */
  async duplicate(id: string): Promise<ProductDetailDto> {
    const source = await this.findRow(id);
    const detail = this.toDetail(source);
    const input: ProductData = {
      categoryId: source.categoryId,
      kind: source.kind,
      name: `${source.name} (cópia)`,
      description: source.description,
      priceCents: source.priceCents,
      promoPriceCents: source.promoPriceCents,
      sku: null,
      externalCode: null,
      sectorId: source.sectorId,
      channels: source.channels as SalesChannel[],
      schedules: detail.schedules,
      sizes: detail.sizes.map((s) => ({
        name: s.name,
        priceCents: s.priceCents,
        promoPriceCents: s.promoPriceCents,
        externalCode: null,
      })),
      flavorPrices: detail.flavorPrices.map((f) => ({
        sizeId: f.sizeId,
        priceCents: f.priceCents,
        promoPriceCents: f.promoPriceCents,
      })),
      modifierLinks: detail.modifierLinks.map((l) => ({
        groupId: l.groupId,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
        isDisabled: l.isDisabled,
      })),
    };
    const copy = await this.create(input);

    const image =
      source.imageKey && source.thumbKey
        ? await this.images.copyProductImage(this.imageFolder(), {
            imageKey: source.imageKey,
            thumbKey: source.thumbKey,
          })
        : null;
    // Right after the original: shift the following products down by one.
    await this.db.product.updateMany({
      where: {
        categoryId: source.categoryId,
        deletedAt: null,
        sortOrder: { gt: source.sortOrder },
        id: { not: copy.id },
      },
      data: { sortOrder: { increment: 1 } },
    });
    await this.db.product.update({
      where: { id: copy.id },
      data: {
        isPaused: true,
        pausedUntil: null,
        sortOrder: source.sortOrder + 1,
        ...(image && { imageKey: image.imageKey, thumbKey: image.thumbKey }),
      },
    });
    return this.get(copy.id);
  }

  async reorder(categoryId: string, ids: string[]): Promise<ProductListItemDto[]> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.product.findMany({
        where: { categoryId, deletedAt: null },
        select: { id: true },
      });
      await applyOrder(
        tx,
        'product',
        ids,
        existing.map((p) => p.id),
      );
    });
    return this.list({ categoryId, status: 'all' });
  }

  // ---------------------------------------------------------------------------
  // Pause ("Acabou")

  private async setPause(id: string, state: PauseState): Promise<ProductDetailDto> {
    await this.findRow(id);
    await this.db.product.update({ where: { id }, data: state });
    return this.get(id);
  }

  async pause(id: string, input: PauseInput) {
    return this.setPause(id, await this.menu.pauseState(input));
  }

  async resume(id: string) {
    return this.setPause(id, RESUMED);
  }

  /** Pauses a single size ("acabou o 2 L") or a pizza flavor in one size. */
  async setSizePause(id: string, sizeId: string, input: PauseInput | null) {
    const price = await this.db.productSizePrice.findFirst({ where: { productId: id, sizeId } });
    if (!price) throw new NotFoundError('Tamanho');
    const state = input ? await this.menu.pauseState(input) : RESUMED;
    await this.db.productSizePrice.update({ where: { id: price.id }, data: state });
    return this.get(id);
  }

  // ---------------------------------------------------------------------------
  // Image

  private imageFolder() {
    return `t/${this.ctx.tenantId}/products`;
  }

  async setImage(id: string, file: UploadedImage): Promise<ProductDetailDto> {
    const before = await this.findRow(id);
    const stored = await this.images.storeProductImage(this.imageFolder(), file);
    await this.db.product.update({ where: { id }, data: stored });
    await this.images.remove(before.imageKey, before.thumbKey);
    return this.get(id);
  }

  async removeImage(id: string): Promise<ProductDetailDto> {
    const before = await this.findRow(id);
    await this.db.product.update({ where: { id }, data: { imageKey: null, thumbKey: null } });
    await this.images.remove(before.imageKey, before.thumbKey);
    return this.get(id);
  }
}
