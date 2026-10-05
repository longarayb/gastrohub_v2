import { Injectable } from '@nestjs/common';
import type { SectorDto, SectorInput } from '@app/shared';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import type { ProductionSector } from '../../generated/prisma/client.js';
import { applyOrder } from './menu-common.js';

const toDto = (s: ProductionSector): SectorDto => ({
  id: s.id,
  name: s.name,
  sortOrder: s.sortOrder,
  isDefault: s.isDefault,
  isActive: s.isActive,
  warnAfterMinutes: s.warnAfterMinutes,
  lateAfterMinutes: s.lateAfterMinutes,
});

@Injectable()
export class SectorsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(): Promise<SectorDto[]> {
    const sectors = await this.db.productionSector.findMany({ orderBy: { sortOrder: 'asc' } });
    return sectors.map(toDto);
  }

  async create(input: SectorInput): Promise<SectorDto> {
    return this.db.$transaction(async (tx) => {
      const count = await tx.productionSector.count();
      // The first sector becomes the default one.
      const isDefault = !!input.isDefault || count === 0;
      if (isDefault) await tx.productionSector.updateMany({ data: { isDefault: false } });
      const sector = await tx.productionSector.create({
        data: {
          name: input.name,
          isActive: input.isActive ?? true,
          isDefault,
          sortOrder: count,
          ...(input.warnAfterMinutes && { warnAfterMinutes: input.warnAfterMinutes }),
          ...(input.lateAfterMinutes && { lateAfterMinutes: input.lateAfterMinutes }),
        },
      });
      return toDto(sector);
    });
  }

  async update(id: string, input: SectorInput): Promise<SectorDto> {
    return this.db.$transaction(async (tx) => {
      const current = await tx.productionSector.findUnique({ where: { id } });
      if (!current) throw new NotFoundError('Setor');
      if (input.isDefault) {
        await tx.productionSector.updateMany({
          where: { id: { not: id } },
          data: { isDefault: false },
        });
      }
      const sector = await tx.productionSector.update({
        where: { id },
        // A default sector cannot be "un-defaulted" directly: pick another default instead.
        data: {
          name: input.name,
          isActive: input.isActive ?? current.isActive,
          isDefault: input.isDefault || current.isDefault,
          warnAfterMinutes: input.warnAfterMinutes ?? current.warnAfterMinutes,
          lateAfterMinutes: input.lateAfterMinutes ?? current.lateAfterMinutes,
        },
      });
      return toDto(sector);
    });
  }

  /** Products of a removed sector fall back to the default sector (sectorId = null). */
  async remove(id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const current = await tx.productionSector.findUnique({ where: { id } });
      if (!current) throw new NotFoundError('Setor');
      // Its tickets are the kitchen's history (preparation times): deactivate it instead.
      if (await tx.productionTask.count({ where: { sectorId: id } })) {
        throw new ConflictError('Este setor já recebeu pedidos. Desative-o em vez de excluir.');
      }
      await tx.productionSector.delete({ where: { id } });
      if (current.isDefault) {
        const next = await tx.productionSector.findFirst({ orderBy: { sortOrder: 'asc' } });
        if (next)
          await tx.productionSector.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  async reorder(ids: string[]): Promise<SectorDto[]> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.productionSector.findMany({ select: { id: true } });
      await applyOrder(
        tx,
        'productionSector',
        ids,
        existing.map((s) => s.id),
      );
    });
    return this.list();
  }
}
