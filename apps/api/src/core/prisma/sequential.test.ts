import { findFirstSequential, mergeLoaded, splitInclude } from './sequential.js';

describe('splitInclude', () => {
  it('leaves at most one relation per level in each variant', () => {
    expect(
      splitInclude({
        movements: { orderBy: { createdAt: 'asc' } },
        counts: true,
        payments: { include: { order: { select: { number: true } } } },
        options: {
          where: { deletedAt: null },
          include: {
            product: { select: { name: true } },
            sizePrices: { select: { sizeId: true } },
          },
        },
        group: { select: { name: true } },
        _count: { select: { products: { where: { deletedAt: null } } } },
        skipped: false,
      }),
    ).toEqual([
      { movements: { orderBy: { createdAt: 'asc' } } },
      { counts: true },
      { payments: { include: { order: { select: { number: true } } } } },
      { options: { where: { deletedAt: null }, include: { product: { select: { name: true } } } } },
      {
        options: {
          where: { deletedAt: null },
          include: { sizePrices: { select: { sizeId: true } } },
        },
      },
      { group: { select: { name: true } } },
      { _count: { select: { products: { where: { deletedAt: null } } } } },
    ]);
  });

  it('splits relations inside a select, keeping the scalars and the id', () => {
    expect(
      splitInclude({ product: { select: { name: true, a: { select: { x: true } }, b: true } } }),
    ).toEqual([
      { product: { select: { id: true, name: true, b: true, a: { select: { x: true } } } } },
    ]);
  });
});

describe('mergeLoaded', () => {
  it('merges lists by id and nested objects', () => {
    expect(
      mergeLoaded(
        {
          id: 'g',
          options: [
            { id: '1', product: null },
            { id: '2', product: { name: 'P' } },
          ],
        },
        {
          id: 'g',
          options: [
            { id: '2', sizePrices: [1] },
            { id: '1', sizePrices: [] },
          ],
        },
      ),
    ).toEqual({
      id: 'g',
      options: [
        { id: '1', product: null, sizePrices: [] },
        { id: '2', product: { name: 'P' }, sizePrices: [1] },
      ],
    });
  });
});

describe('mergeLoaded with values', () => {
  it('keeps dates as values', () => {
    const at = new Date('2026-10-07T10:00:00Z');
    const merged = mergeLoaded(
      { id: 'p', category: { id: 'c', at } },
      { category: { id: 'c', at } },
    ) as {
      category: { at: Date };
    };
    expect(merged.category.at).toBeInstanceOf(Date);
    expect(merged.category.at.toISOString()).toBe('2026-10-07T10:00:00.000Z');
  });
});

describe('findFirstSequential', () => {
  it('runs one query at a time and returns the full shape', async () => {
    let running = 0;
    let maxRunning = 0;
    const calls: unknown[] = [];
    const delegate = {
      async findFirst(args: Record<string, unknown>) {
        running++;
        maxRunning = Math.max(maxRunning, running);
        calls.push(args);
        await new Promise((r) => setTimeout(r, 1));
        running--;
        const select = args.select as Record<string, unknown> | undefined;
        if (!select) return { id: 's1', status: 'OPEN' };
        if ('movements' in select) return { movements: [{ id: 'm1' }] };
        return { payments: [{ id: 'p1' }] };
      },
    };
    const row = await findFirstSequential(delegate, {
      where: { id: 's1' },
      include: { movements: true, payments: true },
    });
    expect(row).toEqual({
      id: 's1',
      status: 'OPEN',
      movements: [{ id: 'm1' }],
      payments: [{ id: 'p1' }],
    });
    expect(maxRunning).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it('returns null when the record does not exist', async () => {
    const delegate = { findFirst: async () => null };
    expect(await findFirstSequential(delegate, { where: { id: 'x' }, include: { a: true } })).toBe(
      null,
    );
  });
});
