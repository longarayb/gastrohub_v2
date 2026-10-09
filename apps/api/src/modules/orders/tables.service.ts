import { Injectable } from '@nestjs/common';
import type { AreaDto, TableDto } from '@app/shared';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

@Injectable()
export class TablesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
    private readonly ctx: TenantContext,
  ) {}

  async listAreas(): Promise<AreaDto[]> {
    return this.db.area.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    });
  }

  async createArea(name: string): Promise<AreaDto> {
    const count = await this.db.area.count();
    return this.db.area.create({
      data: { name, sortOrder: count },
      select: { id: true, name: true, sortOrder: true },
    });
  }

  async removeArea(id: string): Promise<void> {
    const area = await this.db.area.findFirst({ where: { id } });
    if (!area) throw new NotFoundError('Área');
    await this.db.area.delete({ where: { id } });
  }

  /** Tables with their open session and the tabs (orders) open on it. */
  async listTables(): Promise<TableDto[]> {
    const tables = await this.db.table.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        area: { select: { name: true } },
        sessions: {
          where: { leftAt: null, session: { closedAt: null } },
          include: {
            session: {
              include: {
                orders: {
                  where: { status: { notIn: ['DELIVERED', 'CANCELED'] } },
                  select: {
                    id: true,
                    number: true,
                    tabLabel: true,
                    totalCents: true,
                    paidCents: true,
                    paymentStatus: true,
                  },
                  orderBy: [{ businessDate: 'asc' }, { number: 'asc' }],
                },
              },
            },
          },
        },
      },
    });
    return tables.map((t) => {
      const link = t.sessions[0];
      return {
        id: t.id,
        name: t.name,
        areaId: t.areaId,
        areaName: t.area?.name ?? null,
        seats: t.seats,
        isActive: t.isActive,
        session: link
          ? {
              id: link.session.id,
              openedAt: link.session.openedAt.toISOString(),
              billRequestedAt: link.session.billRequestedAt?.toISOString() ?? null,
              tabs: link.session.orders.map((o) => ({
                orderId: o.id,
                number: o.number,
                tabLabel: o.tabLabel,
                totalCents: o.totalCents,
                paidCents: o.paidCents,
                paymentStatus: o.paymentStatus,
              })),
            }
          : null,
      };
    });
  }

  private duplicate<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Já existe uma mesa com esse nome');
      }
      throw error;
    });
  }

  async createTable(input: {
    name: string;
    areaId: string | null;
    seats?: number | null;
    isActive?: boolean;
  }) {
    const count = await this.db.table.count();
    await this.duplicate(
      this.db.table.create({
        data: {
          name: input.name,
          areaId: input.areaId,
          seats: input.seats ?? null,
          isActive: input.isActive ?? true,
          sortOrder: count,
        },
      }),
    );
    this.realtime.tablesUpdated(this.ctx.tenantId);
    return this.listTables();
  }

  async updateTable(
    id: string,
    input: { name: string; areaId: string | null; seats?: number | null; isActive?: boolean },
  ) {
    const table = await this.db.table.findFirst({ where: { id } });
    if (!table) throw new NotFoundError('Mesa');
    await this.duplicate(
      this.db.table.update({
        where: { id },
        data: {
          name: input.name,
          areaId: input.areaId,
          seats: input.seats ?? null,
          isActive: input.isActive ?? true,
        },
      }),
    );
    this.realtime.tablesUpdated(this.ctx.tenantId);
    return this.listTables();
  }
}
