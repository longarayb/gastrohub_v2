/**
 * Digital menu rules (docs/DECISOES.md D032–D034): open/closed with the next opening, the
 * restaurant brand color, cart checks against the current menu, abuse limits, customer-facing
 * rejection reasons, the tracking timeline and the privacy notice template. Pure functions,
 * shared by the API (authoritative) and the menu app.
 */
import type { OrderItemData } from '../orders/schemas.js';
import {
  type CatalogIndex,
  ItemPricingError,
  priceCatalogItem,
} from '../orders/catalog-pricing.js';
import type { BusinessHour } from '../stores/schemas.js';
import { onlyDigits } from '../utils/documents.js';
import {
  DEFAULT_TIMEZONE,
  addDaysToDate,
  minutesToTime,
  timeToMinutes,
  toLocalTime,
  weekdayOfDate,
  zonedTimeToInstant,
} from '../utils/datetime.js';
import type { OrderStatus, OrderType } from './order-status.js';
import { isWithinSchedule } from './business-day.js';

// ---------------------------------------------------------------------------
// Open / closed

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface StoreOpenState {
  open: boolean;
  /** Next opening when closed (null: no opening hours in the next 7 days). */
  nextOpening: { at: string; label: string } | null;
}

/**
 * Open now? When closed, the next opening as "hoje às 18:00", "amanhã às 11:00" or
 * "sexta às 11:00". Without opening hours the store is always open (same rule as the API).
 */
export function storeOpenState(
  hours: readonly BusinessHour[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): StoreOpenState {
  if (isWithinSchedule(hours, now, timeZone)) return { open: true, nextOpening: null };
  const today = toLocalTime(now, timeZone).businessDate;
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDaysToDate(today, offset);
    const starts = hours
      .filter((h) => h.weekday === weekdayOfDate(date))
      .map((h) => timeToMinutes(h.opensAt))
      .sort((a, b) => a - b);
    for (const minutes of starts) {
      const at = zonedTimeToInstant(date, minutes, timeZone);
      if (at <= now) continue;
      const day =
        offset === 0 ? 'hoje' : offset === 1 ? 'amanhã' : WEEKDAY_NAMES[weekdayOfDate(date)]!;
      return {
        open: false,
        nextOpening: { at: at.toISOString(), label: `${day} às ${minutesToTime(minutes)}` },
      };
    }
  }
  return { open: false, nextOpening: null };
}

// ---------------------------------------------------------------------------
// Brand color of the restaurant

export const isHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two "#rrggbb" colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text color on top of the brand color: white or near-black, whichever reads better. */
export function readableForeground(background: string): '#ffffff' | '#111111' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111111')
    ? '#ffffff'
    : '#111111';
}

// ---------------------------------------------------------------------------
// Cart vs the current menu

export interface SavedCartLine {
  key: string;
  input: OrderItemData;
  /** Unit price the customer saw when adding the item. */
  unitChargedPriceCents: number;
}

export type CartLineChange =
  | { key: string; kind: 'UNAVAILABLE'; message: string }
  | { key: string; kind: 'PRICE_CHANGED'; fromCents: number; toCents: number };

/** Items of a saved cart that ran out or changed price since they were added. */
export function cartChanges(
  lines: readonly SavedCartLine[],
  index: CatalogIndex,
): CartLineChange[] {
  const changes: CartLineChange[] = [];
  for (const line of lines) {
    try {
      const priced = priceCatalogItem(index, line.input);
      if (priced.unitChargedPriceCents !== line.unitChargedPriceCents) {
        changes.push({
          key: line.key,
          kind: 'PRICE_CHANGED',
          fromCents: line.unitChargedPriceCents,
          toCents: priced.unitChargedPriceCents,
        });
      }
    } catch (error) {
      if (!(error instanceof ItemPricingError) && !(error instanceof RangeError)) throw error;
      changes.push({ key: line.key, kind: 'UNAVAILABLE', message: error.message });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Abuse limits (all configurable per restaurant)

export interface DigitalOrderLimits {
  /** Orders of a phone not finished yet (the main protection). */
  perPhoneOpen: number;
  /** Orders of a phone per business day. */
  perPhoneDay: number;
  /** Orders per IP per hour: wide, mobile carriers share IPs (CGNAT); only against bots. */
  perIpHour: number;
  /** Digital menu orders waiting for the restaurant to accept. */
  storePending: number;
}

export const DEFAULT_DIGITAL_ORDER_LIMITS: DigitalOrderLimits = {
  perPhoneOpen: 2,
  perPhoneDay: 10,
  perIpHour: 30,
  storePending: 20,
};

export interface DigitalOrderCounts {
  phoneOpen: number;
  phoneDay: number;
  ipHour: number;
  storePending: number;
}

/** pt-BR message when a new order goes over a limit, else null. */
export function digitalOrderLimitError(
  counts: DigitalOrderCounts,
  limits: DigitalOrderLimits,
): string | null {
  if (counts.phoneOpen >= limits.perPhoneOpen) {
    return 'Você já tem pedidos em andamento neste restaurante. Acompanhe-os antes de fazer outro.';
  }
  if (counts.phoneDay >= limits.perPhoneDay) {
    return 'Limite de pedidos por dia atingido para este telefone. Fale com o restaurante.';
  }
  if (counts.storePending >= limits.storePending) {
    return 'O restaurante está com muitos pedidos agora. Tente de novo em alguns minutos.';
  }
  if (counts.ipHour >= limits.perIpHour) {
    return 'Muitos pedidos a partir desta conexão. Tente de novo mais tarde.';
  }
  return null;
}

/** Mobile phone with DDD (11 digits, 9 after the DDD): the digital menu needs one. */
export function isMobilePhone(value: string): boolean {
  const digits = onlyDigits(value);
  return digits.length === 11 && digits[2] === '9' && Number(digits.slice(0, 2)) >= 11;
}

// ---------------------------------------------------------------------------
// Rejection: reason shown to the customer (an internal note is kept apart)

export const CUSTOMER_REJECTION_REASONS = [
  'OUT_OF_STOCK',
  'OUTSIDE_DELIVERY_HOURS',
  'TOO_BUSY',
  'OUT_OF_AREA',
  'OTHER',
] as const;
export type CustomerRejectionReason = (typeof CUSTOMER_REJECTION_REASONS)[number];
export const CUSTOMER_REJECTION_LABELS: Record<CustomerRejectionReason, string> = {
  OUT_OF_STOCK: 'Item esgotado',
  OUTSIDE_DELIVERY_HOURS: 'Fora do horário de entrega',
  TOO_BUSY: 'Restaurante muito movimentado',
  OUT_OF_AREA: 'Endereço fora da área de entrega',
  OTHER: 'Outro motivo',
};

/** What the tracking page says: the label, or the restaurant's text for "Outro". */
export function customerRejectionMessage(
  reason: CustomerRejectionReason | null,
  text: string | null,
): string {
  if (!reason) return 'O restaurante cancelou o pedido.';
  return reason === 'OTHER' && text ? text : CUSTOMER_REJECTION_LABELS[reason];
}

// ---------------------------------------------------------------------------
// Tracking

export interface TrackingStep {
  key: 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'DISPATCHED' | 'DELIVERED';
  label: string;
  done: boolean;
  current: boolean;
  at: string | null;
}

/** Customer-facing timeline of an order (canceled orders show their own message instead). */
export function trackingTimeline(
  type: OrderType,
  status: OrderStatus,
  times: {
    createdAt: string;
    acceptedAt: string | null;
    readyAt: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  },
): TrackingStep[] {
  const delivery = type === 'DELIVERY';
  const steps: Omit<TrackingStep, 'done' | 'current'>[] = [
    { key: 'RECEIVED', label: 'Pedido recebido', at: times.createdAt },
    { key: 'ACCEPTED', label: 'Aceito pelo restaurante', at: times.acceptedAt },
    { key: 'PREPARING', label: 'Em preparo', at: null },
    {
      key: 'READY',
      label: delivery ? 'Pronto, aguardando o entregador' : 'Pronto para retirar',
      at: times.readyAt,
    },
    ...(delivery
      ? [{ key: 'DISPATCHED' as const, label: 'Saiu para entrega', at: times.dispatchedAt }]
      : []),
    { key: 'DELIVERED', label: delivery ? 'Entregue' : 'Retirado', at: times.deliveredAt },
  ];
  const reached: Record<OrderStatus, TrackingStep['key']> = {
    PENDING: 'RECEIVED',
    ACCEPTED: 'ACCEPTED',
    PREPARING: 'PREPARING',
    READY: 'READY',
    DISPATCHED: 'DISPATCHED',
    DELIVERED: 'DELIVERED',
    CANCELED: 'RECEIVED',
  };
  const currentIndex = steps.findIndex((s) => s.key === reached[status]);
  return steps.map((s, i) => ({
    ...s,
    done: i <= currentIndex,
    current: i === currentIndex && status !== 'DELIVERED',
  }));
}

/** Estimated arrival (delivery) or pickup time, from when the restaurant accepted. */
export function estimatedTime(input: {
  type: OrderType;
  createdAt: string;
  acceptedAt: string | null;
  etaMinutes: number;
}): string {
  const base = new Date(input.acceptedAt ?? input.createdAt).getTime();
  return new Date(base + input.etaMinutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Privacy notice (template: the restaurant is the data controller and must review it)

export const PRIVACY_NOTICE_VERSION = '2026-10';

export function privacyNoticeTemplate(store: {
  name: string;
  legalName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
}): string {
  const who = store.legalName
    ? `${store.legalName}${store.cnpj ? ` (CNPJ ${store.cnpj})` : ''}`
    : store.name;
  const contact = [store.email, store.phone].filter(Boolean).join(' ou ');
  return [
    `${who} é o responsável (controlador) pelos dados informados neste pedido.`,
    'Usamos seu nome, telefone e endereço somente para preparar, entregar e falar com você sobre este pedido e os próximos feitos aqui. Seus dados não são compartilhados com outros restaurantes.',
    'O endereço é enviado a um serviço de mapas apenas para calcular a área e a taxa de entrega, sem seu nome ou telefone.',
    `Você pode pedir acesso, correção ou exclusão dos seus dados${contact ? ` pelo contato ${contact}` : ' com o restaurante'}.`,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Item description (cart, tracking)

/** "Grande · ½ Calabresa, ½ Marguerita · 2× Bacon, Catupiry · Obs.: sem cebola". */
export function describeItem(snapshot: {
  size: { name: string } | null;
  flavors: { name: string; fraction: { numerator: number; denominator: number } }[];
  modifiers: { name: string; quantity: number }[];
  note: string | null;
}): string | null {
  const fraction = (f: { numerator: number; denominator: number }) =>
    f.numerator === 1 && f.denominator > 1
      ? (({ 2: '½', 3: '⅓', 4: '¼' } as Record<number, string>)[f.denominator] ??
        `1/${f.denominator}`)
      : '';
  const parts = [
    snapshot.size?.name,
    snapshot.flavors.length > 1
      ? snapshot.flavors.map((f) => `${fraction(f.fraction)} ${f.name}`.trim()).join(', ')
      : snapshot.flavors[0]?.name,
    snapshot.modifiers
      .map((m) => (m.quantity > 1 ? `${m.quantity}× ${m.name}` : m.name))
      .join(', '),
    snapshot.note ? `Obs.: ${snapshot.note}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
