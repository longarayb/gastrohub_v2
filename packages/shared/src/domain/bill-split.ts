/**
 * Splitting a bill (docs/DECISOES.md D025). Pure, cents only.
 *
 * - Even split is a calculator of partial payments on the same tab: the balance is split in
 *   N shares; leftover cents go to the first shares (R$ 100 / 3 = 33,34 + 33,33 + 33,33).
 * - Split by items moves order lines to another tab of the same table session. A line can be
 *   broken by quantity (move 1 of 3); a value discount is shared in proportion to the
 *   quantities and a percent discount stays the same on both parts.
 */

import { allocateByWeights, allocateEvenly } from '../utils/money.js';
import { calculateLine, type DiscountType } from './order-totals.js';

export const MAX_SPLIT_PEOPLE = 30;

/** Shares of the balance for `people` payers. */
export function splitEvenly(balanceCents: number, people: number): number[] {
  if (!Number.isInteger(people) || people < 1 || people > MAX_SPLIT_PEOPLE) {
    throw new RangeError(`Divida entre 1 e ${MAX_SPLIT_PEOPLE} pessoas`);
  }
  if (!Number.isInteger(balanceCents) || balanceCents < 0) throw new RangeError('Saldo inválido');
  return allocateEvenly(balanceCents, people);
}

export interface SplittableLine {
  id: string;
  status: string;
  quantity: number;
  unitChargedPriceCents: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

export interface LinePart {
  quantity: number;
  discountValue: number | null;
  discountCents: number;
  totalCents: number;
}

/** Breaks a line in two: `moveQuantity` units go to another tab, the rest stays. */
export function splitLine(
  line: SplittableLine,
  moveQuantity: number,
): { keep: LinePart; move: LinePart } {
  if (!Number.isInteger(moveQuantity) || moveQuantity < 1 || moveQuantity >= line.quantity) {
    throw new RangeError('Quantidade inválida para dividir o item');
  }
  const keepQuantity = line.quantity - moveQuantity;
  const [keepValue, moveValue] =
    line.discountType === 'VALUE'
      ? allocateByWeights(line.discountValue ?? 0, [keepQuantity, moveQuantity])
      : [line.discountValue, line.discountValue];
  const part = (quantity: number, discountValue: number | null | undefined): LinePart => {
    const totals = calculateLine({
      quantity,
      unitChargedPriceCents: line.unitChargedPriceCents,
      discount: line.discountType ? { type: line.discountType, value: discountValue ?? 0 } : null,
    });
    return {
      quantity,
      discountValue: line.discountType ? (discountValue ?? 0) : null,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
    };
  };
  return { keep: part(keepQuantity, keepValue), move: part(moveQuantity, moveValue) };
}

export interface MoveSelection {
  itemId: string;
  quantity: number;
}

export interface MoveItemsPlan {
  /** Lines that move as they are. */
  whole: string[];
  /** Lines broken in two (part stays, part moves). */
  partial: { itemId: string; keep: LinePart; move: LinePart }[];
}

export type MoveItemsCheck = { ok: true; plan: MoveItemsPlan } | { ok: false; message: string };

/** Validates the selection and decides which lines move whole and which are broken. */
export function moveItemsPlan(
  lines: readonly SplittableLine[],
  selections: readonly MoveSelection[],
): MoveItemsCheck {
  if (selections.length === 0) return { ok: false, message: 'Selecione os itens' };
  const seen = new Set<string>();
  const plan: MoveItemsPlan = { whole: [], partial: [] };
  for (const selection of selections) {
    if (seen.has(selection.itemId)) return { ok: false, message: 'Item repetido na seleção' };
    seen.add(selection.itemId);
    const line = lines.find((l) => l.id === selection.itemId);
    if (!line) return { ok: false, message: 'Item não encontrado nesta conta' };
    if (line.status === 'CANCELED') {
      return { ok: false, message: 'Itens cancelados não podem ser transferidos' };
    }
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > line.quantity
    ) {
      return { ok: false, message: 'Quantidade inválida para transferir' };
    }
    if (selection.quantity === line.quantity) plan.whole.push(line.id);
    else plan.partial.push({ itemId: line.id, ...splitLine(line, selection.quantity) });
  }
  return { ok: true, plan };
}
