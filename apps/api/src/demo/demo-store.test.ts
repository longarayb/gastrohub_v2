import { isOpenAt, toLocalTime } from '@app/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_DEMO_HOURS, demoStoreData } from './demo-store.js';

describe('demo unit', () => {
  it('sets every column of Store (a nightly reset must undo any visitor change)', () => {
    const managed = new Set(['id', 'organizationId', 'slug', 'createdAt', 'updatedAt']);
    const columns = Object.values(Prisma.StoreScalarFieldEnum).filter((c) => !managed.has(c));
    const set = Object.keys(demoStoreData({ demoMode: true }));
    expect(columns.filter((c) => !set.includes(c))).toEqual([]);
  });

  it('public demo: open at any hour except the reset window (04:00–04:30, Brasília)', () => {
    // 2026-10-13 is a Tuesday; Brasília is UTC-3.
    const open = (hhmm: string) => {
      const { weekday, minutes } = toLocalTime(new Date(`2026-10-13T${hhmm}:00-03:00`));
      return isOpenAt(PUBLIC_DEMO_HOURS, weekday, minutes);
    };
    for (const time of ['04:30', '09:00', '12:00', '18:00', '23:59', '00:30', '03:59']) {
      expect(open(time), time).toBe(true);
    }
    expect(open('04:10')).toBe(false);
  });
});
