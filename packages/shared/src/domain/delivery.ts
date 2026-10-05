/**
 * Delivery rules (docs/DECISOES.md D029–D031). Pure; also used by the digital menu later.
 *
 * - Areas by neighborhood (recommended default: the CEP lookup already returns it) or by radius
 *   from the store. A neighborhood area accepts name variations ("Centro", "Centro Histórico").
 * - A neighborhood match wins over a radius; among radii the smallest that covers the address.
 * - A paused area (rain, no courier) refuses the address instead of falling into another area.
 * - Courier pay = per delivery + share of the delivery fees + daily (once per business day).
 * - Settlement: what the courier collected enters the register of whoever settles; the courier
 *   keeps a running balance (restaurant owes courier) fed by earnings and reduced by payouts.
 */

import { formatBRL } from '../utils/money.js';
import type { PaymentMethod } from '../orders/schemas.js';

export const DELIVERY_AREA_KINDS = ['NEIGHBORHOOD', 'RADIUS'] as const;
export type DeliveryAreaKind = (typeof DELIVERY_AREA_KINDS)[number];

export const DELIVERY_FAILURE_REASONS = [
  'CUSTOMER_ABSENT',
  'ADDRESS_NOT_FOUND',
  'REFUSED',
  'OTHER',
] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];
export const DELIVERY_FAILURE_LABELS: Record<DeliveryFailureReason, string> = {
  CUSTOMER_ABSENT: 'Cliente ausente',
  ADDRESS_NOT_FOUND: 'Endereço não encontrado',
  REFUSED: 'Cliente recusou',
  OTHER: 'Outro motivo',
};

// ---------------------------------------------------------------------------
// Places and distances

/** "Centro Histórico " → "centro historico" (accents, case, punctuation, spaces). */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Areas

export interface DeliveryAreaRule {
  id: string;
  name: string;
  kind: DeliveryAreaKind;
  /** Neighborhood names and their variations (any spelling; compared normalized). */
  neighborhoods: string[];
  /** Neighborhood areas: the city they belong to (null = any city of the store). */
  city: string | null;
  radiusMeters: number | null;
  feeCents: number;
  etaMinutes: number;
  minimumOrderCents: number | null;
  freeAboveCents: number | null;
  /** Temporarily paused (rain, no courier): refuses addresses until resumed. */
  pausedReason: string | null;
  pausedUntil: Date | string | null;
  sortOrder: number;
}

export interface DeliveryAddressInput {
  neighborhood: string;
  city: string;
  coordinates?: Coordinates | null;
}

export function isAreaPaused(
  area: Pick<DeliveryAreaRule, 'pausedReason' | 'pausedUntil'>,
  now: Date,
): boolean {
  if (!area.pausedReason) return false;
  return !area.pausedUntil || new Date(area.pausedUntil) > now;
}

export function matchesNeighborhood(
  area: DeliveryAreaRule,
  address: DeliveryAddressInput,
): boolean {
  if (area.kind !== 'NEIGHBORHOOD') return false;
  if (area.city && normalizePlace(area.city) !== normalizePlace(address.city)) return false;
  const wanted = normalizePlace(address.neighborhood);
  return !!wanted && area.neighborhoods.some((n) => normalizePlace(n) === wanted);
}

export type AreaResolution =
  | {
      ok: true;
      area: DeliveryAreaRule;
      matchedBy: 'NEIGHBORHOOD' | 'RADIUS';
      distanceMeters: number | null;
    }
  | { ok: false; reason: 'PAUSED'; area: DeliveryAreaRule; message: string }
  | { ok: false; reason: 'OUT_OF_AREA' | 'NEEDS_COORDINATES'; message: string };

/**
 * Area of an address. Neighborhood first (works without geocoding), then the smallest radius
 * covering the coordinates. A paused match refuses the address (no fallback to another area).
 */
export function resolveDeliveryArea(
  address: DeliveryAddressInput,
  areas: readonly DeliveryAreaRule[],
  options: { store: Coordinates | null; now: Date },
): AreaResolution {
  const sorted = [...areas].sort((a, b) => a.sortOrder - b.sortOrder);
  const paused = (area: DeliveryAreaRule): AreaResolution => ({
    ok: false,
    reason: 'PAUSED',
    area,
    message: `Entrega temporariamente indisponível para ${area.name}${area.pausedReason ? ` (${area.pausedReason})` : ''}`,
  });

  const byName = sorted.find((a) => matchesNeighborhood(a, address));
  if (byName) {
    return isAreaPaused(byName, options.now)
      ? paused(byName)
      : { ok: true, area: byName, matchedBy: 'NEIGHBORHOOD', distanceMeters: null };
  }

  const radii = sorted.filter((a) => a.kind === 'RADIUS' && a.radiusMeters);
  if (radii.length) {
    if (!address.coordinates || !options.store) {
      return {
        ok: false,
        reason: 'NEEDS_COORDINATES',
        message: 'Não foi possível localizar o endereço no mapa: escolha a área manualmente',
      };
    }
    const distance = distanceMeters(options.store, address.coordinates);
    const covering = radii
      .filter((a) => distance <= a.radiusMeters!)
      .sort((a, b) => a.radiusMeters! - b.radiusMeters! || a.sortOrder - b.sortOrder);
    const area = covering[0];
    if (area) {
      return isAreaPaused(area, options.now)
        ? paused(area)
        : { ok: true, area, matchedBy: 'RADIUS', distanceMeters: distance };
    }
  }
  return { ok: false, reason: 'OUT_OF_AREA', message: 'Endereço fora da área de entrega' };
}

export interface DeliveryQuote {
  /** Fee charged (0 when the order reaches "free above"). */
  feeCents: number;
  /** Fee of the area before "free above" (what a manual fee is compared against). */
  areaFeeCents: number;
  etaMinutes: number;
  minimumOrderCents: number;
  belowMinimum: boolean;
  freeDelivery: boolean;
}

/** Fee, time and minimum of an area for an order subtotal. */
export function deliveryQuote(
  area: Pick<DeliveryAreaRule, 'feeCents' | 'etaMinutes' | 'minimumOrderCents' | 'freeAboveCents'>,
  subtotalCents: number,
  storeMinimumCents: number,
): DeliveryQuote {
  const minimumOrderCents = area.minimumOrderCents ?? storeMinimumCents;
  const freeDelivery = area.freeAboveCents != null && subtotalCents >= area.freeAboveCents;
  return {
    feeCents: freeDelivery ? 0 : area.feeCents,
    areaFeeCents: area.feeCents,
    etaMinutes: area.etaMinutes,
    minimumOrderCents,
    belowMinimum: subtotalCents < minimumOrderCents,
    freeDelivery,
  };
}

/** A fee typed by the operator vs the suggested one: reducing needs permission; any change is audited. */
export function feeChange(
  suggestedCents: number,
  chosenCents: number,
): 'SAME' | 'INCREASE' | 'REDUCE' {
  if (chosenCents === suggestedCents) return 'SAME';
  return chosenCents > suggestedCents ? 'INCREASE' : 'REDUCE';
}

/** Neighborhoods seen in orders/customers that no area covers (to add them as variations). */
export function unmatchedNeighborhoods(
  seen: readonly { neighborhood: string; city: string; at: Date | string }[],
  areas: readonly DeliveryAreaRule[],
): { neighborhood: string; city: string; occurrences: number; lastSeenAt: string }[] {
  const groups = new Map<
    string,
    { neighborhood: string; city: string; occurrences: number; lastSeenAt: string }
  >();
  for (const s of seen) {
    if (!normalizePlace(s.neighborhood)) continue;
    if (areas.some((a) => matchesNeighborhood(a, s))) continue;
    const key = `${normalizePlace(s.city)}|${normalizePlace(s.neighborhood)}`;
    const at = new Date(s.at).toISOString();
    const current = groups.get(key);
    if (current) {
      current.occurrences++;
      if (at > current.lastSeenAt) current.lastSeenAt = at;
    } else {
      groups.set(key, {
        neighborhood: s.neighborhood.trim(),
        city: s.city.trim(),
        occurrences: 1,
        lastSeenAt: at,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.occurrences - a.occurrences || b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
}

// ---------------------------------------------------------------------------
// Maps

export interface MapAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** "Abrir no Google Maps" / "Abrir no Waze": coordinates when known, else the address text. */
export function mapLinks(address: MapAddress): { google: string; waze: string } {
  if (address.latitude != null && address.longitude != null) {
    const ll = `${address.latitude},${address.longitude}`;
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${ll}`,
      waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    };
  }
  const text = encodeURIComponent(
    `${address.street}, ${address.number} - ${address.neighborhood}, ${address.city} - ${address.state}${address.cep ? `, ${address.cep}` : ''}`,
  );
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${text}`,
    waze: `https://waze.com/ul?q=${text}&navigate=yes`,
  };
}

// ---------------------------------------------------------------------------
// Couriers

export type CourierStatus = 'AVAILABLE' | 'ON_ROUTE' | 'INACTIVE';
export const COURIER_STATUS_LABELS: Record<CourierStatus, string> = {
  AVAILABLE: 'Disponível',
  ON_ROUTE: 'Em rota',
  INACTIVE: 'Inativo',
};

/** Computed, never stored: it can never go stale. */
export function courierStatus(courier: { isActive: boolean; hasOpenRun: boolean }): CourierStatus {
  if (courier.hasOpenRun) return 'ON_ROUTE';
  return courier.isActive ? 'AVAILABLE' : 'INACTIVE';
}

export interface CourierPayRule {
  perDeliveryCents: number;
  /** Share of the delivery fees, in basis points (10000 = the whole fee). */
  feeShareBps: number;
  dailyCents: number;
}

/** Courier override (null fields) falls back to the store rule. */
export function effectivePayRule(
  store: CourierPayRule,
  courier: {
    perDeliveryCents: number | null;
    feeShareBps: number | null;
    dailyCents: number | null;
  },
): CourierPayRule {
  return {
    perDeliveryCents: courier.perDeliveryCents ?? store.perDeliveryCents,
    feeShareBps: courier.feeShareBps ?? store.feeShareBps,
    dailyCents: courier.dailyCents ?? store.dailyCents,
  };
}

export interface CourierEarnings {
  perDeliveryCents: number;
  feeShareCents: number;
  dailyCents: number;
  totalCents: number;
}

/** Pay of a settlement: delivered stops only; the daily once per business day. */
export function courierEarnings(
  rule: CourierPayRule,
  input: { deliveries: number; deliveryFeesCents: number; includeDaily: boolean },
): CourierEarnings {
  const perDeliveryCents = rule.perDeliveryCents * input.deliveries;
  const feeShareCents = Math.round((input.deliveryFeesCents * rule.feeShareBps) / 10_000);
  const dailyCents = input.includeDaily ? rule.dailyCents : 0;
  return {
    perDeliveryCents,
    feeShareCents,
    dailyCents,
    totalCents: perDeliveryCents + feeShareCents + dailyCents,
  };
}

export interface SettlementStop {
  /** What is still owed by the customer for this order (0 = already paid, e.g. online). */
  balanceCents: number;
  /** How the customer paid (declared by the courier, confirmed by the operator). */
  method: PaymentMethod;
}

export interface SettlementSummary {
  expectedCashCents: number;
  expectedCardCents: number;
  /** PIX to the store key or other methods: confirmed without counting money. */
  otherCents: number;
  countedCashCents: number;
  countedCardCents: number;
  /** counted − expected (negative = missing). */
  cashDifferenceCents: number;
  cardDifferenceCents: number;
  earningsCents: number;
  previousBalanceCents: number;
  payoutCents: number;
  /** Missing cash deducted from what the restaurant owes the courier. */
  shortageDeductedCents: number;
  /** Restaurant owes the courier (running balance after this settlement). */
  newBalanceCents: number;
  /** Courier owes the restaurant (missing cash not deducted). */
  courierOwesCents: number;
}

const CARD_METHODS: readonly PaymentMethod[] = ['CREDIT_CARD', 'DEBIT_CARD', 'MEAL_VOUCHER'];

/**
 * Courier settlement: expected cash and card slips from the delivered orders vs what was
 * counted; earnings enter the running balance, payouts and (optionally) missing cash reduce it.
 */
export function settlementSummary(input: {
  stops: readonly SettlementStop[];
  countedCashCents: number;
  countedCardCents: number;
  earningsCents: number;
  previousBalanceCents: number;
  payoutCents: number;
  deductShortage: boolean;
}): SettlementSummary {
  const sum = (methods: (m: PaymentMethod) => boolean) =>
    input.stops.filter((s) => methods(s.method)).reduce((t, s) => t + s.balanceCents, 0);
  const expectedCashCents = sum((m) => m === 'CASH');
  const expectedCardCents = sum((m) => CARD_METHODS.includes(m));
  const otherCents = sum((m) => m !== 'CASH' && !CARD_METHODS.includes(m));
  const cashDifferenceCents = input.countedCashCents - expectedCashCents;
  const cardDifferenceCents = input.countedCardCents - expectedCardCents;
  const missing = Math.max(-cashDifferenceCents, 0);
  const beforePayout = input.previousBalanceCents + input.earningsCents;
  const shortageDeductedCents = input.deductShortage
    ? Math.min(missing, Math.max(beforePayout, 0))
    : 0;
  return {
    expectedCashCents,
    expectedCardCents,
    otherCents,
    countedCashCents: input.countedCashCents,
    countedCardCents: input.countedCardCents,
    cashDifferenceCents,
    cardDifferenceCents,
    earningsCents: input.earningsCents,
    previousBalanceCents: input.previousBalanceCents,
    payoutCents: input.payoutCents,
    shortageDeductedCents,
    newBalanceCents: beforePayout - shortageDeductedCents - input.payoutCents,
    courierOwesCents: missing - shortageDeductedCents,
  };
}

/** A payout cannot exceed what the restaurant owes the courier. */
export function payoutError(balanceCents: number, payoutCents: number): string | null {
  if (!Number.isInteger(payoutCents) || payoutCents < 0) return 'Valor inválido';
  if (payoutCents > balanceCents) {
    return `Pagamento maior que o saldo do entregador (${formatBRL(Math.max(balanceCents, 0))})`;
  }
  return null;
}
