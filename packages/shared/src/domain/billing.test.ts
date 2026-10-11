import { describe, expect, it } from 'vitest';
import {
  type BillingTimelineInput,
  addMonthsToDate,
  billingPeriod,
  billingTimeline,
  daysBetween,
  monthlyEquivalentCents,
  monthlyRecurringRevenue,
  periodsToInvoice,
  readOnlyStartsAt,
  storeBillingAccess,
  storeLimitError,
  subscriptionCharge,
  subscriptionStatus,
} from './billing.js';
import type { BusinessHour } from './opening-hours.js';

/** São Paulo is UTC−3 all year: 00:00 local = 03:00Z. */
const sp = (local: string) => new Date(`${local}-03:00`);

// Seed-like hours: lunch and dinner; Friday and Saturday dinners cross midnight.
const HOURS: BusinessHour[] = [
  ...[1, 2, 3, 4].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '23:30' },
  ]),
  ...[5, 6].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '02:00' },
  ]),
  { weekday: 0, opensAt: '11:00', closesAt: '16:00' },
];

const base = (over: Partial<BillingTimelineInput> = {}): BillingTimelineInput => ({
  trialEndsOn: null,
  oldestUnpaidDueDate: null,
  nextDueDate: null,
  suspendedAt: null,
  canceledAt: null,
  graceDays: 7,
  warnDaysBefore: 5,
  now: sp('2026-10-01T12:00'),
  ...over,
});

describe('calendar', () => {
  it('keeps the anchor day and clamps to the month length', () => {
    expect(addMonthsToDate('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(addMonthsToDate('2028-01-30', 1, 30)).toBe('2028-02-29');
    expect(addMonthsToDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(daysBetween('2026-10-05', '2026-10-12')).toBe(7);
    expect(daysBetween('2026-10-12', '2026-10-05')).toBe(-7);
  });
});

describe('amounts', () => {
  const plan = { priceCents: 19_900, storeLimit: 2, extraStorePriceCents: 7_900 };

  it('charges extra stores above the limit when the plan allows them', () => {
    expect(subscriptionCharge(plan, 1)).toEqual({
      baseCents: 19_900,
      extraStores: 0,
      extraCents: 0,
      totalCents: 19_900,
    });
    expect(subscriptionCharge(plan, 4).totalCents).toBe(19_900 + 2 * 7_900);
    expect(storeLimitError(plan, 5)).toBeNull();
  });

  it('blocks a new store over a hard limit and never charges stores left after a downgrade', () => {
    const hard = { ...plan, extraStorePriceCents: null };
    expect(storeLimitError(hard, 1)).toBeNull();
    expect(storeLimitError(hard, 2)).toMatch(/inclui 2 unidades/);
    expect(storeLimitError({ ...hard, storeLimit: 1 }, 1)).toMatch(/inclui 1 unidade\./);
    expect(subscriptionCharge(hard, 3).totalCents).toBe(19_900);
    expect(() => subscriptionCharge({ ...plan, priceCents: -1 }, 1)).toThrow(RangeError);
  });

  it('converts period amounts to monthly recurring revenue', () => {
    expect(monthlyEquivalentCents(199_000, 'YEARLY')).toBe(16_583);
    expect(monthlyEquivalentCents(50_000, 'QUARTERLY')).toBe(16_667);
    expect(
      monthlyRecurringRevenue([
        { status: 'ACTIVE', totalCents: 19_900, interval: 'MONTHLY' },
        { status: 'PAST_DUE', totalCents: 120_000, interval: 'YEARLY' },
        { status: 'TRIALING', totalCents: 19_900, interval: 'MONTHLY' },
        { status: 'SUSPENDED', totalCents: 19_900, interval: 'MONTHLY' },
        { status: 'CANCELED', totalCents: 19_900, interval: 'MONTHLY' },
      ]),
    ).toBe(19_900 + 10_000);
  });
});

describe('billing periods', () => {
  const schedule = { billingStart: '2026-08-31', interval: 'MONTHLY' as const };

  it('charges each period in advance, anchored on the start day', () => {
    expect(billingPeriod(schedule, 0)).toEqual({
      periodStart: '2026-08-31',
      periodEnd: '2026-09-29',
      dueDate: '2026-08-31',
    });
    expect(billingPeriod(schedule, 1).periodStart).toBe('2026-09-30');
    expect(billingPeriod(schedule, 2).periodStart).toBe('2026-10-31');
    expect(billingPeriod({ billingStart: '2026-01-15', interval: 'YEARLY' }, 1)).toEqual({
      periodStart: '2027-01-15',
      periodEnd: '2028-01-14',
      dueDate: '2027-01-15',
    });
  });

  it('lists only the missing periods due within the generation window', () => {
    const periods = periodsToInvoice(schedule, {
      today: '2026-10-25',
      billedStarts: new Set(['2026-08-31']),
    });
    expect(periods.map((p) => p.periodStart)).toEqual(['2026-09-30', '2026-10-31']);
    // Generating again creates nothing new.
    expect(
      periodsToInvoice(schedule, {
        today: '2026-10-25',
        billedStarts: new Set(['2026-08-31', '2026-09-30', '2026-10-31']),
      }),
    ).toEqual([]);
    // A canceled subscription stops before its end date.
    expect(
      periodsToInvoice(schedule, {
        today: '2026-10-25',
        billedStarts: new Set(),
        endsOn: '2026-10-01',
      }).map((p) => p.periodStart),
    ).toEqual(['2026-08-31', '2026-09-30']);
  });
});

describe('grace and read-only mode', () => {
  it('becomes eligible at the start of the day after the grace period (São Paulo)', () => {
    const t = billingTimeline(
      base({ oldestUnpaidDueDate: '2026-10-05', now: sp('2026-10-08T10:00') }),
    );
    expect(t.daysOverdue).toBe(3);
    expect(t.graceEndsOn).toBe('2026-10-12');
    expect(t.readOnlyEligibleAt).toEqual(sp('2026-10-13T00:00'));
    expect(t.readOnlyReason).toBe('OVERDUE');
  });

  it('starts right away when the store has not opened yet', () => {
    // Tuesday 00:00: Monday's dinner ended at 23:30, Tuesday opens at 11:00.
    expect(readOnlyStartsAt(sp('2026-10-13T00:00'), HOURS)).toEqual(sp('2026-10-13T00:00'));
  });

  it('waits for the end of an overnight shift', () => {
    // Saturday 00:00 during Friday's 18:00–02:00 dinner.
    expect(readOnlyStartsAt(sp('2026-10-10T00:00'), HOURS)).toEqual(sp('2026-10-10T02:00'));
  });

  it('waits for the end of the business day between lunch and dinner', () => {
    // Manual suspension on Tuesday 16:00: dinner still to come.
    expect(readOnlyStartsAt(sp('2026-10-13T16:00'), HOURS)).toEqual(sp('2026-10-13T23:30'));
    // During lunch.
    expect(readOnlyStartsAt(sp('2026-10-13T12:00'), HOURS)).toEqual(sp('2026-10-13T23:30'));
  });

  it('uses 04:00 local time when the store has no opening hours', () => {
    expect(readOnlyStartsAt(sp('2026-10-13T00:00'), [])).toEqual(sp('2026-10-13T04:00'));
    expect(readOnlyStartsAt(sp('2026-10-13T10:00'), [])).toEqual(sp('2026-10-14T04:00'));
  });

  it('respects the store timezone for the safe moment', () => {
    // Manaus (UTC−4): 00:00 in São Paulo is 23:00 of Monday there, after its dinner ended.
    const at = readOnlyStartsAt(sp('2026-10-13T00:00'), [], 'America/Manaus');
    expect(at).toEqual(new Date('2026-10-13T04:00-04:00'));
  });
});

describe('store access (banners and blocking)', () => {
  const access = (over: Partial<BillingTimelineInput>) =>
    storeBillingAccess({ ...base(over), hours: HOURS });

  it('warns 5 days before the due date, not earlier', () => {
    expect(access({ nextDueDate: '2026-10-10', now: sp('2026-10-04T12:00') }).level).toBe('OK');
    const soon = access({ nextDueDate: '2026-10-10', now: sp('2026-10-05T12:00') });
    expect(soon).toMatchObject({ level: 'DUE_SOON', daysToDue: 5, readOnly: false });
    expect(access({ nextDueDate: '2026-10-10', now: sp('2026-10-10T20:00') }).daysToDue).toBe(0);
  });

  it('shows the trial while it lasts', () => {
    const trial = access({ trialEndsOn: '2026-10-15', nextDueDate: '2026-10-15' });
    expect(trial).toMatchObject({ level: 'TRIAL', trialEndsOn: '2026-10-15' });
  });

  it('is overdue during the grace period, with the date read-only mode will start', () => {
    const late = access({
      oldestUnpaidDueDate: '2026-10-05',
      nextDueDate: '2026-10-05',
      now: sp('2026-10-12T21:00'),
    });
    expect(late).toMatchObject({
      level: 'OVERDUE',
      readOnly: false,
      daysOverdue: 7,
      dueDate: '2026-10-05',
      readOnlyFrom: sp('2026-10-13T00:00'),
    });
  });

  it('blocks new sales only after the boundary, never during the shift', () => {
    // Grace ended on Friday 2026-10-09: eligible Saturday 00:00, Friday dinner runs until 02:00.
    const input = { oldestUnpaidDueDate: '2026-10-02', nextDueDate: '2026-10-02' };
    expect(access({ ...input, now: sp('2026-10-10T01:30') })).toMatchObject({
      level: 'OVERDUE',
      readOnly: false,
      readOnlyFrom: sp('2026-10-10T02:00'),
    });
    expect(access({ ...input, now: sp('2026-10-10T02:00') })).toMatchObject({
      level: 'READ_ONLY',
      readOnly: true,
      readOnlyReason: 'OVERDUE',
    });
  });

  it('unblocks as soon as the payment is registered', () => {
    const paid = access({
      oldestUnpaidDueDate: null,
      nextDueDate: '2026-11-02',
      now: sp('2026-10-20T12:00'),
    });
    expect(paid).toMatchObject({ level: 'OK', readOnly: false, readOnlyFrom: null });
  });

  it('schedules a manual suspension for the end of the business day', () => {
    const s = access({ suspendedAt: sp('2026-10-13T16:00'), now: sp('2026-10-13T16:05') });
    expect(s).toMatchObject({
      level: 'SCHEDULED',
      readOnly: false,
      readOnlyReason: 'SUSPENDED',
      readOnlyFrom: sp('2026-10-13T23:30'),
    });
    expect(
      access({ suspendedAt: sp('2026-10-13T16:00'), now: sp('2026-10-13T23:30') }).readOnly,
    ).toBe(true);
  });

  it('rejects an invalid grace period', () => {
    expect(() => billingTimeline(base({ graceDays: -1 }))).toThrow(RangeError);
  });
});

describe('admin status', () => {
  it('classifies organizations', () => {
    expect(subscriptionStatus(base({ trialEndsOn: '2026-10-15' }))).toBe('TRIALING');
    expect(subscriptionStatus(base({ nextDueDate: '2026-10-20' }))).toBe('ACTIVE');
    expect(
      subscriptionStatus(base({ oldestUnpaidDueDate: '2026-09-28', now: sp('2026-10-01T12:00') })),
    ).toBe('PAST_DUE');
    expect(
      subscriptionStatus(base({ oldestUnpaidDueDate: '2026-09-20', now: sp('2026-10-01T12:00') })),
    ).toBe('SUSPENDED');
    expect(subscriptionStatus(base({ suspendedAt: sp('2026-09-30T10:00') }))).toBe('SUSPENDED');
    expect(subscriptionStatus(base({ canceledAt: sp('2026-09-30T10:00') }))).toBe('CANCELED');
    // An expired trial with no payment counts as overdue from its last day.
    expect(
      subscriptionStatus(
        base({
          trialEndsOn: '2026-09-29',
          oldestUnpaidDueDate: '2026-09-29',
          now: sp('2026-10-01T12:00'),
        }),
      ),
    ).toBe('PAST_DUE');
  });
});
