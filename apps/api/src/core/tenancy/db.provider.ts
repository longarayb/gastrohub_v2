import { Inject, type Provider } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { buildRelationMap, type RuntimeDataModel, tenantExtension } from './tenant-extension.js';

export function getRuntimeDataModel(prisma: PrismaService): RuntimeDataModel {
  // Prisma exposes its data model at runtime; used to walk nested writes.
  const dataModel = (prisma as unknown as { _runtimeDataModel?: RuntimeDataModel })
    ._runtimeDataModel;
  if (!dataModel?.models) {
    throw new Error('Prisma runtime data model unavailable — check the Prisma version');
  }
  return dataModel;
}

export function createScopedClient(prisma: PrismaService, getTenantId: () => string | undefined) {
  const relations = buildRelationMap(getRuntimeDataModel(prisma));
  return prisma.$extends(tenantExtension(getTenantId, relations));
}

/** Tenant-scoped Prisma client. Use it for all business queries. */
export type Db = ReturnType<typeof createScopedClient>;

/** Interactive transaction client of the scoped `Db`. */
export type DbTx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export const DB = Symbol('DB');

/** Injects the tenant-scoped Prisma client: `constructor(@InjectDb() private readonly db: Db)`. */
export const InjectDb = () => Inject(DB);

export const dbProvider: Provider = {
  provide: DB,
  useFactory: (prisma: PrismaService, ctx: TenantContext) =>
    createScopedClient(prisma, () => ctx.tenantIdOrNull),
  inject: [PrismaService, TenantContext],
};
