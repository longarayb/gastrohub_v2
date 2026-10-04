import type { BusinessHour } from '../stores/schemas.js';
import { DEFAULT_TIMEZONE } from '../utils/datetime.js';
import { isWithinSchedule } from './business-day.js';

export const SalesChannel = {
  DINE_IN: 'DINE_IN',
  COUNTER: 'COUNTER',
  DELIVERY: 'DELIVERY',
  DIGITAL_MENU: 'DIGITAL_MENU',
} as const;
export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];
export const SALES_CHANNELS = Object.values(SalesChannel);

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  DINE_IN: 'Salão',
  COUNTER: 'Balcão',
  DELIVERY: 'Delivery',
  DIGITAL_MENU: 'Cardápio digital',
};

export interface Pausable {
  isPaused: boolean;
  /** `null` = paused indefinitely. The pause expires automatically after this instant. */
  pausedUntil: Date | string | null;
}

/** Whether an item is paused right now (an expired `pausedUntil` counts as not paused). */
export function isPausedNow(item: Pausable, now: Date = new Date()): boolean {
  if (!item.isPaused) return false;
  return item.pausedUntil == null || new Date(item.pausedUntil).getTime() > now.getTime();
}

export interface AvailabilityRules extends Pausable {
  channels: readonly SalesChannel[];
  schedules: readonly BusinessHour[];
  deletedAt?: Date | string | null;
}

export type UnavailableCode =
  | 'DELETED'
  | 'CATEGORY_PAUSED'
  | 'PRODUCT_PAUSED'
  | 'SIZE_PAUSED'
  | 'CATEGORY_CHANNEL'
  | 'PRODUCT_CHANNEL'
  | 'CATEGORY_SCHEDULE'
  | 'PRODUCT_SCHEDULE'
  | 'STORE_CLOSED';

export interface UnavailableReason {
  code: UnavailableCode;
  message: string;
}

export interface Availability {
  available: boolean;
  reasons: UnavailableReason[];
}

export interface AvailabilityInput {
  category: AvailabilityRules;
  product: AvailabilityRules;
  /** Selected size (for sized products / pizzas); only its pause matters. */
  size?: Pausable | null;
  channel: SalesChannel;
  now?: Date;
  timeZone?: string;
  /** Opening hours; checked only when `enforceStoreHours` is true (digital menu). */
  storeHours?: readonly BusinessHour[];
  enforceStoreHours?: boolean;
}

function pausedMessage(what: string, item: Pausable, timeZone: string): string {
  if (item.pausedUntil == null) return `${what} pausado`;
  const until = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.pausedUntil));
  return `${what} pausado até ${until}`;
}

/**
 * Single source of truth for "can this product be sold now, in this channel?".
 * Used by the API (validation), the POS and the digital menu (display).
 */
export function getProductAvailability(input: AvailabilityInput): Availability {
  const now = input.now ?? new Date();
  const tz = input.timeZone ?? DEFAULT_TIMEZONE;
  const { category, product, size, channel } = input;
  const reasons: UnavailableReason[] = [];
  const add = (code: UnavailableCode, message: string) => reasons.push({ code, message });
  const channelLabel = SALES_CHANNEL_LABELS[channel];

  if (category.deletedAt || product.deletedAt) add('DELETED', 'Item removido do cardápio');
  if (isPausedNow(category, now)) add('CATEGORY_PAUSED', pausedMessage('Categoria', category, tz));
  if (isPausedNow(product, now)) add('PRODUCT_PAUSED', pausedMessage('Produto', product, tz));
  if (size && isPausedNow(size, now)) add('SIZE_PAUSED', pausedMessage('Tamanho', size, tz));
  if (!category.channels.includes(channel)) {
    add('CATEGORY_CHANNEL', `Categoria indisponível em: ${channelLabel}`);
  }
  if (!product.channels.includes(channel)) {
    add('PRODUCT_CHANNEL', `Produto indisponível em: ${channelLabel}`);
  }
  if (!isWithinSchedule(category.schedules, now, tz)) {
    add('CATEGORY_SCHEDULE', 'Categoria fora do horário de venda');
  }
  if (!isWithinSchedule(product.schedules, now, tz)) {
    add('PRODUCT_SCHEDULE', 'Produto fora do horário de venda');
  }
  if (input.enforceStoreHours && !isWithinSchedule(input.storeHours ?? [], now, tz)) {
    // An empty list of hours means "always open" for this check.
    add('STORE_CLOSED', 'Loja fechada no momento');
  }

  return { available: reasons.length === 0, reasons };
}
