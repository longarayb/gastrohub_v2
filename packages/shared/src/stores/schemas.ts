import { z } from 'zod';
import { zAddress, zCNPJ, zEmail, zPhone, zSlug, zTime } from '../schemas/common.js';
import { timeToMinutes } from '../utils/datetime.js';

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;

export const updateStoreSchema = z.object({
  tradeName: z.string().trim().min(2, 'Informe o nome fantasia'),
  legalName: z.string().trim().min(2, 'Informe a razão social'),
  cnpj: zCNPJ,
  phone: zPhone,
  email: zEmail.optional().or(z.literal('').transform(() => null)),
  slug: zSlug,
  address: zAddress,
});
export type UpdateStoreInput = z.input<typeof updateStoreSchema>;

export const storeSettingsSchema = z.object({
  /** Service fee in basis points (1000 = 10%). Applied to dine-in orders. */
  serviceFeeBps: z.number().int().min(0).max(3000),
  /** Minutes after which a KDS ticket is highlighted as late. */
  kdsLateAfterMinutes: z.number().int().min(1).max(240),
  /** Whether the digital menu accepts orders. */
  digitalMenuEnabled: z.boolean(),
  /** Minimum order value for delivery, in cents. */
  deliveryMinimumCents: z.number().int().min(0),
  /** Estimated preparation time for takeout, in minutes. */
  takeoutEtaMinutes: z.number().int().min(0).max(480),
  /** Automatically accept orders from the digital menu. */
  autoAcceptDigitalOrders: z.boolean(),
  /** How a pizza with several flavors is priced. */
  pizzaPricingRule: z.enum(['HIGHEST', 'AVERAGE']),
  /** Order types that get the service fee by default (dine-in only unless configured). */
  serviceFeeOrderTypes: z
    .array(z.enum(['DINE_IN', 'TAKEOUT', 'DELIVERY']))
    .transform((list) => [...new Set(list)]),
});
export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;

/**
 * Opening interval. `closesAt` earlier than `opensAt` means it crosses midnight
 * (e.g. 18:00 → 02:00).
 */
export const businessHourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opensAt: zTime,
    closesAt: zTime,
  })
  .refine((v) => v.opensAt !== v.closesAt, {
    message: 'Abertura e fechamento não podem ser iguais',
    path: ['closesAt'],
  });

export const businessHoursSchema = z.object({
  hours: z.array(businessHourSchema).max(28),
});
export type BusinessHoursInput = z.input<typeof businessHoursSchema>;

export const createStoreSchema = z.object({
  tradeName: z.string().trim().min(2, 'Informe o nome fantasia'),
  legalName: z.string().trim().min(2, 'Informe a razão social'),
  cnpj: zCNPJ,
  phone: zPhone,
  slug: zSlug.optional(),
});
export type CreateStoreInput = z.input<typeof createStoreSchema>;

export interface BusinessHour {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

/**
 * Whether the store is open at the given local weekday/minute.
 * Handles intervals crossing midnight (they belong to the weekday they start on).
 */
export function isOpenAt(
  hours: readonly BusinessHour[],
  weekday: number,
  minutes: number,
): boolean {
  const previousWeekday = (weekday + 6) % 7;
  return hours.some((h) => {
    const open = timeToMinutes(h.opensAt);
    const close = timeToMinutes(h.closesAt);
    const crossesMidnight = close < open;
    if (h.weekday === weekday) {
      return crossesMidnight ? minutes >= open : minutes >= open && minutes < close;
    }
    if (crossesMidnight && h.weekday === previousWeekday) {
      return minutes < close;
    }
    return false;
  });
}
