/**
 * Prisma 7 loads the relations of an `include` with parallel queries. Inside an interactive
 * transaction they share one pg connection, so they pile up on it — pg 8 warns ("client.query()
 * when the client is already executing a query") and pg 9 will throw. Reads with several
 * relations inside a transaction go through `findFirstSequential`: the record first, then each
 * relation path in its own query, one at a time (never two relations on the same level).
 */

type Spec = Record<string, unknown>;

/** Plain objects only: Dates, Decimals and Buffers in the rows are values, not records. */
const isObject = (v: unknown): v is Spec => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Relation keys of a nested spec (`include` or `select` with object values). */
function nestedRelations(spec: Spec): { key: 'include' | 'select'; relations: Spec } | null {
  if (isObject(spec.include)) return { key: 'include', relations: spec.include };
  if (isObject(spec.select)) {
    const relations = Object.fromEntries(
      Object.entries(spec.select).filter(([, v]) => isObject(v)),
    );
    if (Object.keys(relations).length) return { key: 'select', relations };
  }
  return null;
}

/**
 * Splits an `include` into variants with at most one relation per level, as `select` objects
 * for the parent model. `{ a, b: { include: { c, d } } }` → `[{ a }, { b: {include:{c}} }, { b: {include:{d}} }]`.
 */
export function splitInclude(include: Spec): Spec[] {
  const variants: Spec[] = [];
  for (const [key, spec] of Object.entries(include)) {
    if (!spec) continue;
    // Counts are computed in the parent query (no relation rows to load).
    if (key === '_count' || !isObject(spec)) {
      variants.push({ [key]: spec });
      continue;
    }
    const nested = nestedRelations(spec);
    if (!nested) {
      variants.push({ [key]: spec });
      continue;
    }
    const inner = splitInclude(nested.relations);
    if (nested.key === 'include') {
      const { include: _drop, ...rest } = spec;
      if (inner.length === 0) variants.push({ [key]: rest });
      for (const v of inner) variants.push({ [key]: { ...rest, include: v } });
    } else {
      // select: keep the scalar fields (and the id, to merge) in every variant.
      const scalars = Object.fromEntries(
        Object.entries(spec.select as Spec).filter(([, v]) => !isObject(v)),
      );
      for (const v of inner) {
        variants.push({ [key]: { ...spec, select: { id: true, ...scalars, ...v } } });
      }
    }
  }
  return variants;
}

/** Deep merge of the partial results (lists merged by `id`, else by position). */
export function mergeLoaded(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) {
    return target.map((item, i) => {
      const id = isObject(item) ? item.id : undefined;
      const match = id !== undefined ? source.find((s) => isObject(s) && s.id === id) : source[i];
      return match === undefined ? item : mergeLoaded(item, match);
    });
  }
  if (isObject(target) && isObject(source)) {
    const out: Spec = { ...target };
    for (const [k, v] of Object.entries(source)) {
      out[k] = k in target ? mergeLoaded(target[k], v) : v;
    }
    return out;
  }
  return source === undefined ? target : source;
}

/** Any Prisma model delegate (the arguments are checked by Prisma at runtime). */
interface FindFirstDelegate {
  findFirst(args: never): PromiseLike<unknown>;
}

/**
 * `delegate.findFirst({ where, include })` without parallel queries on the connection: use it
 * for reads with more than one relation inside `$transaction`. The model needs an `id`.
 */
export async function findFirstSequential<T>(
  delegate: FindFirstDelegate,
  args: { where: Spec; include: Spec },
): Promise<T | null> {
  const find = (query: Spec) =>
    (delegate as unknown as { findFirst(a: Spec): Promise<unknown> }).findFirst(query);
  const base = (await find({ where: args.where })) as Spec | null;
  if (!base) return null;
  let result: unknown = base;
  for (const select of splitInclude(args.include)) {
    const part = await find({ where: { id: base.id }, select });
    result = mergeLoaded(result, part);
  }
  return result as T;
}
