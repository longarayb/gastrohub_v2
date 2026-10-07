/**
 * Kitchen display (KDS) rules (docs/DECISOES.md D027). Pure.
 *
 * - Every sent order item becomes one or more production tasks, one per sector. The line goes
 *   to its sector; a combo option referencing a product of ANOTHER sector becomes its own task
 *   there (the combo drink goes to the bar). The same routing feeds printing per sector.
 * - A ticket is (round, sector): items added later to a tab are a new ticket.
 * - Item status follows its tasks; the order status follows all its tasks.
 */

import type { MenuItemSnapshot } from './menu-pricing.js';
import type { OrderStatus } from './order-status.js';

export const PRODUCTION_TASK_STATUSES = ['QUEUED', 'PREPARING', 'READY', 'CANCELED'] as const;
export type ProductionTaskStatus = (typeof PRODUCTION_TASK_STATUSES)[number];
export type ProductionTaskKind = 'ITEM' | 'COMBO_PART';

/** Default alert limits of a new sector, in minutes since the ticket was sent. */
export const DEFAULT_SECTOR_WARN_MINUTES = 10;
export const DEFAULT_SECTOR_LATE_MINUTES = 20;
/** Finished tickets stay in "Pronto (recentes)" for this long, then leave the screen. */
export const KDS_RECENT_MINUTES = 15;
/** And at most this many of them (a screen open all day must not pile them up). */
export const KDS_RECENT_LIMIT = 20;

/** Title of an order on the kitchen screen and tickets: "Mesa 2 + 3 · Carlos", the customer, or "Balcão". */
export function orderDisplayTitle(o: {
  type: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  tabLabel: string | null;
  customerName: string | null;
  tableNames: string[];
}): string {
  if (o.type === 'DINE_IN') {
    const table = o.tableNames.length ? `Mesa ${o.tableNames.join(' + ')}` : 'Mesa';
    return o.tabLabel ? `${table} · ${o.tabLabel}` : table;
  }
  return o.customerName ?? (o.type === 'TAKEOUT' ? 'Balcão' : 'Delivery');
}

// ---------------------------------------------------------------------------
// Removals ("sem cebola")

const REMOVAL_RE = /^\s*(sem|tirar|retirar|não colocar|nao colocar)\b/i;

/** "Sem cebola", "tirar tomate": instructions the kitchen must not miss. */
export function isRemoval(text: string): boolean {
  return REMOVAL_RE.test(text);
}

/** Splits a free note into lines, flagging the removal ones ("sem cebola, bem passado"). */
export function noteParts(note: string | null | undefined): { text: string; removal: boolean }[] {
  if (!note?.trim()) return [];
  return note
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text) => ({ text, removal: isRemoval(text) }));
}

// ---------------------------------------------------------------------------
// Routing

export interface TaskDetails {
  size: string | null;
  /** Pizza flavors with their fraction and note. */
  flavors: { name: string; fraction: string | null; note: string | null }[];
  /** Options prepared by this sector (same-sector combo parts included). */
  modifiers: { name: string; quantity: number; removal: boolean }[];
  /** Item note ("bem passado, sem cebola"). */
  note: string | null;
  /** Removal instructions found in options and notes, shown with strong emphasis. */
  removals: string[];
  /** COMBO_PART: the combo it belongs to. */
  comboOf: string | null;
}

export interface RoutedTask {
  sectorId: string;
  kind: ProductionTaskKind;
  name: string;
  quantity: number;
  details: TaskDetails;
}

/**
 * Tasks of one order item: the line in its sector (`itemSectorId`, already resolved with the
 * default sector) plus one task per combo option whose product belongs to another sector.
 */
export function routeItem(
  snapshot: MenuItemSnapshot,
  quantity: number,
  itemSectorId: string,
): RoutedTask[] {
  const elsewhere = snapshot.modifiers.filter(
    (m) => m.product && m.sectorId && m.sectorId !== itemSectorId,
  );
  const here = snapshot.modifiers.filter((m) => !elsewhere.includes(m));
  const flavorCount = snapshot.flavors.length;
  const removals = [
    ...here.filter((m) => isRemoval(m.name)).map((m) => m.name),
    ...noteParts(snapshot.note)
      .filter((p) => p.removal)
      .map((p) => p.text),
    ...snapshot.flavors.flatMap((f) =>
      noteParts(f.note)
        .filter((p) => p.removal)
        .map((p) => (flavorCount > 1 ? `${f.name}: ${p.text}` : p.text)),
    ),
  ];
  const main: RoutedTask = {
    sectorId: itemSectorId,
    kind: 'ITEM',
    name: snapshot.name,
    quantity,
    details: {
      // Pizzas and sized products already carry the size in their name.
      size:
        snapshot.kind === 'PIZZA' || !snapshot.size || snapshot.name.includes(snapshot.size.name)
          ? null
          : snapshot.size.name,
      flavors: snapshot.flavors.map((f) => ({
        name: f.name,
        fraction: flavorCount > 1 ? `${f.fraction.numerator}/${f.fraction.denominator}` : null,
        note: f.note,
      })),
      modifiers: here.map((m) => ({
        name: m.name,
        quantity: m.quantity,
        removal: isRemoval(m.name),
      })),
      note: snapshot.note,
      removals,
      comboOf: null,
    },
  };
  const parts = elsewhere.map<RoutedTask>((m) => ({
    sectorId: m.sectorId!,
    kind: 'COMBO_PART',
    name: m.product!.name,
    quantity: quantity * m.quantity,
    details: {
      size: null,
      flavors: [],
      modifiers: [],
      note: null,
      removals: [],
      comboOf: snapshot.name,
    },
  }));
  return [main, ...parts];
}

/**
 * Quantity of a task when its order line is split (move 1 of 3 to another tab): tasks scale
 * with the line (a combo drink part is `line quantity × option quantity`).
 */
export function scaleTaskQuantity(
  taskQuantity: number,
  lineQuantity: number,
  newLineQuantity: number,
): number {
  return (taskQuantity / lineQuantity) * newLineQuantity;
}

// ---------------------------------------------------------------------------
// Status

export type DerivedItemStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'CANCELED';

/** Status of an order item from its tasks (all canceled = canceled; all done = ready). */
export function deriveItemStatus(statuses: readonly ProductionTaskStatus[]): DerivedItemStatus {
  const active = statuses.filter((s) => s !== 'CANCELED');
  if (active.length === 0) return 'CANCELED';
  if (active.every((s) => s === 'READY')) return 'READY';
  if (active.some((s) => s !== 'QUEUED')) return 'PREPARING';
  return 'QUEUED';
}

/**
 * Automatic order transitions from the kitchen: PREPARING when the first task starts, READY
 * when every active task of every sent round is ready, back to PREPARING when a "ready" is
 * undone. Only orders accepted and still in the kitchen move (never PENDING, dispatched,
 * delivered or canceled). Returns the path to apply (possibly two steps), or [].
 */
export function kitchenTransitions(
  status: OrderStatus,
  statuses: readonly ProductionTaskStatus[],
): OrderStatus[] {
  if (!['ACCEPTED', 'PREPARING', 'READY'].includes(status)) return [];
  const active = statuses.filter((s) => s !== 'CANCELED');
  if (active.length === 0) return [];
  const allReady = active.every((s) => s === 'READY');
  const started = active.some((s) => s !== 'QUEUED');
  if (allReady)
    return status === 'ACCEPTED' ? ['PREPARING', 'READY'] : status === 'PREPARING' ? ['READY'] : [];
  if (status === 'READY') return ['PREPARING'];
  if (status === 'ACCEPTED' && started) return ['PREPARING'];
  return [];
}

// ---------------------------------------------------------------------------
// Screen helpers

export type TimerLevel = 'ok' | 'warn' | 'late';

/** Ticket timer color from the sector limits (minutes since it was sent). */
export function timerLevel(
  sentAt: Date | string,
  now: Date,
  limits: { warnAfterMinutes: number; lateAfterMinutes: number },
): TimerLevel {
  const minutes = (now.getTime() - new Date(sentAt).getTime()) / 60_000;
  if (minutes >= limits.lateAfterMinutes) return 'late';
  if (minutes >= limits.warnAfterMinutes) return 'warn';
  return 'ok';
}

/** Consolidated view: pending quantity per product in the sector, largest first. */
export function consolidate(
  tasks: readonly {
    name: string;
    size?: string | null;
    quantity: number;
    status: ProductionTaskStatus;
  }[],
): { name: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== 'QUEUED' && t.status !== 'PREPARING') continue;
    const key = t.size ? `${t.name} (${t.size})` : t.name;
    totals.set(key, (totals.get(key) ?? 0) + t.quantity);
  }
  return [...totals]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Alert limits are positive and the red one comes after the yellow one. */
export function sectorLimitsError(warn: number, late: number): string | null {
  if (!Number.isInteger(warn) || warn < 1) return 'Informe o alerta amarelo em minutos';
  if (!Number.isInteger(late) || late <= warn) {
    return 'O alerta vermelho deve vir depois do amarelo';
  }
  return null;
}
