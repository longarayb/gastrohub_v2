import { Injectable } from '@nestjs/common';
import {
  type CategoryDto,
  type CategorySizesInput,
  type PauseInput,
  type SalesChannel,
  categorySchema,
} from '@app/shared';
import type { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MenuContext, type PauseState, RESUMED, applyOrder, iso } from './menu-common.js';

type CategoryData = z.output<typeof categorySchema>;

const categoryInclude = {
  sizes: { orderBy: { sortOrder: 'asc' } },
  schedules: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] },
  modifierLinks: { orderBy: { sortOrder: 'asc' }, include: { group: { select: { name: true } } } },
  _count: { select: { products: { where: { deletedAt: null } } } },
} satisfies Prisma.CategoryInclude;

type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>;

/** Ensures every group exists (and is not deleted) in this unit. */
export async function assertGroupsExist(tx: DbTx | Db, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  const found = await tx.modifierGroup.count({
    where: { id: { in: [...new Set(groupIds)] }, deletedAt: null },
  });
  if (found !== new Set(groupIds).size) {
    throw new ValidationError('Grupo de complementos não encontrado');
  }
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly menu: MenuContext,
  ) {}

  private toDto(c: CategoryRow): CategoryDto {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      kind: c.kind,
      sortOrder: c.sortOrder,
      isPaused: c.isPaused,
      pausedUntil: iso(c.pausedUntil),
      channels: c.channels as SalesChannel[],
      schedules: c.schedules.map((s) => ({
        weekday: s.weekday,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
      })),
      modifierLinks: c.modifierLinks.map((l) => ({
        groupId: l.groupId,
        groupName: l.group.name,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
        sortOrder: l.sortOrder,
        isDisabled: l.isDisabled,
      })),
      sizes: c.sizes.map((s) => ({
        id: s.id,
        name: s.name,
        sortOrder: s.sortOrder,
        maxFlavors: s.maxFlavors,
        slices: s.slices,
        externalCode: s.externalCode,
      })),
      productCount: c._count.products,
    };
  }

  private findRaw(id: string, client: Db | DbTx = this.db): Promise<CategoryRow | null> {
    return client.category.findFirst({ where: { id, deletedAt: null }, include: categoryInclude });
  }

  async get(id: string): Promise<CategoryDto> {
    const category = await this.findRaw(id);
    if (!category) throw new NotFoundError('Categoria');
    return this.toDto(category);
  }

  async list(): Promise<CategoryDto[]> {
    const categories = await this.db.category.findMany({
      where: { deletedAt: null },
      include: categoryInclude,
      orderBy: { sortOrder: 'asc' },
    });
    return categories.map((c) => this.toDto(c));
  }

  private async writeNested(tx: DbTx, categoryId: string, input: CategoryData): Promise<void> {
    await assertGroupsExist(
      tx,
      input.modifierLinks.map((l) => l.groupId),
    );
    await tx.availabilitySchedule.deleteMany({ where: { categoryId } });
    if (input.schedules.length) {
      await tx.availabilitySchedule.createMany({
        data: input.schedules.map((s) => ({ ...s, categoryId })),
      });
    }
    await tx.modifierGroupLink.deleteMany({ where: { categoryId } });
    if (input.modifierLinks.length) {
      await tx.modifierGroupLink.createMany({
        // Category links cannot be "disabled"; that flag only exists on product links.
        data: input.modifierLinks.map((l, sortOrder) => ({
          categoryId,
          groupId: l.groupId,
          minSelect: l.minSelect,
          maxSelect: l.maxSelect,
          sortOrder,
          isDisabled: false,
        })),
      });
    }
  }

  async create(input: CategoryData): Promise<CategoryDto> {
    const id = await this.db.$transaction(async (tx) => {
      const last = await tx.category.findFirst({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const category = await tx.category.create({
        data: {
          name: input.name,
          description: input.description,
          kind: input.kind,
          channels: input.channels,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      await this.writeNested(tx, category.id, input);
      return category.id;
    });
    return this.get(id);
  }

  async update(id: string, input: CategoryData): Promise<CategoryDto> {
    await this.db.$transaction(async (tx) => {
      const current = await this.findRaw(id, tx);
      if (!current) throw new NotFoundError('Categoria');
      if (current.kind !== input.kind && current._count.products > 0) {
        throw new ValidationError(
          'Não é possível mudar o tipo de uma categoria que já tem produtos',
        );
      }
      await tx.category.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          kind: input.kind,
          channels: input.channels,
        },
      });
      await this.writeNested(tx, id, input);
    });
    return this.get(id);
  }

  /** Replaces the sizes of a pizza category (keeps ids of existing sizes). */
  async setSizes(id: string, input: CategorySizesInput): Promise<CategoryDto> {
    await this.db.$transaction(async (tx) => {
      const category = await this.findRaw(id, tx);
      if (!category) throw new NotFoundError('Categoria');
      if (category.kind !== 'PIZZA') {
        throw new ValidationError('Tamanhos compartilhados existem apenas em categorias de pizza');
      }
      const existingIds = new Set(category.sizes.map((s) => s.id));
      const keep = input.sizes.filter((s) => s.id).map((s) => s.id!);
      if (keep.some((sizeId) => !existingIds.has(sizeId))) {
        throw new ValidationError('Tamanho não pertence a esta categoria');
      }
      // Removing a size also removes flavor/option prices for it (cascade). Orders keep snapshots.
      await tx.size.deleteMany({ where: { categoryId: id, id: { notIn: keep } } });
      for (const [sortOrder, size] of input.sizes.entries()) {
        const data = {
          name: size.name,
          maxFlavors: size.maxFlavors,
          slices: size.slices ?? null,
          externalCode: size.externalCode ?? null,
          sortOrder,
        };
        if (size.id) await tx.size.update({ where: { id: size.id }, data });
        else await tx.size.create({ data: { ...data, categoryId: id } });
      }
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const category = await this.findRaw(id);
    if (!category) throw new NotFoundError('Categoria');
    if (category._count.products > 0) {
      throw new ConflictError('Mova ou exclua os produtos desta categoria antes de excluí-la');
    }
    await this.db.category.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async reorder(ids: string[]): Promise<CategoryDto[]> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.category.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      await applyOrder(
        tx,
        'category',
        ids,
        existing.map((c) => c.id),
      );
    });
    return this.list();
  }

  async setPause(id: string, state: PauseState): Promise<CategoryDto> {
    const category = await this.findRaw(id);
    if (!category) throw new NotFoundError('Categoria');
    await this.db.category.update({ where: { id }, data: state });
    return this.get(id);
  }

  async pause(id: string, input: PauseInput): Promise<CategoryDto> {
    return this.setPause(id, await this.menu.pauseState(input));
  }

  async resume(id: string): Promise<CategoryDto> {
    return this.setPause(id, RESUMED);
  }
}
