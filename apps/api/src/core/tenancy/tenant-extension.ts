import { Prisma } from '../../generated/prisma/client.js';
import { TENANT_MODELS } from './tenant-models.js';

/** Minimal shape of Prisma's runtime data model used to walk nested writes. */
export interface RuntimeDataModel {
  models: Record<string, { fields: { name: string; kind: string; type: string }[] }>;
}

/** model -> relation field name -> related model */
export type RelationMap = Map<string, Map<string, string>>;

export function buildRelationMap(dataModel: RuntimeDataModel): RelationMap {
  const map: RelationMap = new Map();
  for (const [model, { fields }] of Object.entries(dataModel.models)) {
    map.set(model, new Map(fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])));
  }
  return map;
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const mapOne = <T>(value: T | T[], fn: (v: T) => T): T | T[] =>
  Array.isArray(value) ? value.map(fn) : fn(value);

/**
 * Returns a copy of `data` (create input for `model`) with `tenantId` injected into
 * the model itself and into every nested create/connectOrCreate/upsert of tenant models.
 */
export function injectTenant(
  relations: RelationMap,
  model: string,
  data: Data,
  tenantId: string,
  isCreate: boolean,
): Data {
  const result: Data = { ...data };

  if (isCreate && TENANT_MODELS.has(model)) {
    if (result.tenantId !== undefined && result.tenantId !== tenantId) {
      throw new Error(`Cross-tenant write blocked on ${model}`);
    }
    result.tenantId = tenantId;
  }

  const modelRelations = relations.get(model);
  if (!modelRelations) return result;

  for (const [field, target] of modelRelations) {
    const nested = result[field];
    if (!isObject(nested)) continue;
    const ops: Data = { ...nested };

    const inject = (value: unknown, create: boolean) =>
      isObject(value) ? injectTenant(relations, target, value, tenantId, create) : value;

    if (ops.create !== undefined) {
      ops.create = mapOne(ops.create as Data | Data[], (v) => inject(v, true) as Data);
    }
    if (isObject(ops.createMany) && Array.isArray(ops.createMany.data)) {
      ops.createMany = {
        ...ops.createMany,
        data: ops.createMany.data.map((v: unknown) => inject(v, true)),
      };
    }
    if (ops.connectOrCreate !== undefined) {
      ops.connectOrCreate = mapOne(ops.connectOrCreate as Data | Data[], (v) => ({
        ...v,
        create: inject(v.create, true),
      }));
    }
    if (ops.upsert !== undefined) {
      ops.upsert = mapOne(ops.upsert as Data | Data[], (v) => ({
        ...v,
        create: inject(v.create, true),
        update: inject(v.update, false),
      }));
    }
    if (ops.update !== undefined) {
      ops.update = mapOne(ops.update as Data | Data[], (v) =>
        // to-many nested update has the shape { where, data }; to-one is the data itself
        'data' in v && 'where' in v
          ? { ...v, data: inject(v.data, false) }
          : (inject(v, false) as Data),
      );
    }
    result[field] = ops;
  }
  return result;
}

/** Rewrites the arguments of a top-level operation so it is restricted to `tenantId`. */
export function scopeArgs(
  relations: RelationMap,
  model: string,
  operation: string,
  args: Data | undefined,
  tenantId: string,
): Data {
  const scoped: Data = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = { ...(isObject(scoped.where) ? scoped.where : {}), tenantId };
  }

  switch (operation) {
    case 'create':
      scoped.data = injectTenant(relations, model, (scoped.data as Data) ?? {}, tenantId, true);
      break;
    case 'createMany':
    case 'createManyAndReturn':
      scoped.data = mapOne(scoped.data as Data | Data[], (d) =>
        injectTenant(relations, model, d, tenantId, true),
      );
      break;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      if (isObject(scoped.data)) {
        if ('tenantId' in scoped.data) throw new Error(`tenantId cannot be changed on ${model}`);
        scoped.data = injectTenant(relations, model, scoped.data, tenantId, false);
      }
      break;
    case 'upsert':
      scoped.create = injectTenant(relations, model, (scoped.create as Data) ?? {}, tenantId, true);
      scoped.update = injectTenant(
        relations,
        model,
        (scoped.update as Data) ?? {},
        tenantId,
        false,
      );
      break;
  }
  return scoped;
}

/**
 * Prisma Client extension that scopes every operation on tenant models to the
 * tenant returned by `getTenantId()`. Throws when no tenant is available.
 */
export function tenantExtension(getTenantId: () => string | undefined, relations: RelationMap) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            // Nested creates of tenant models inside non-tenant models (e.g. User.memberships)
            const tenantId = getTenantId();
            if (tenantId && (operation === 'create' || operation === 'update') && isObject(args)) {
              return query(scopeNestedOnly(relations, model, args as Data, tenantId) as never);
            }
            return query(args);
          }
          const tenantId = getTenantId();
          if (!tenantId) {
            throw new Error(
              `Tenant context missing for ${model}.${operation}. Use TenantContext.run() or the raw PrismaService.`,
            );
          }
          return query(scopeArgs(relations, model, operation, args as Data, tenantId) as never);
        },
      },
    },
  });
}

function scopeNestedOnly(
  relations: RelationMap,
  model: string,
  args: Data,
  tenantId: string,
): Data {
  if (!isObject(args.data)) return args;
  return { ...args, data: injectTenant(relations, model, args.data, tenantId, false) };
}
