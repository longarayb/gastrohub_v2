/** Rules for modifier group links (category + product) and option prices. */

export interface ModifierLink {
  groupId: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  /** Only meaningful on product links: hides a group inherited from the category. */
  isDisabled?: boolean;
}

export interface EffectiveModifierLink extends ModifierLink {
  source: 'CATEGORY' | 'PRODUCT';
}

/**
 * Effective modifier groups of a product: category links plus product links. A product
 * link for the same group overrides min/max/order of the category link; a product link
 * with `isDisabled` removes the inherited group. Sorted by `sortOrder` (category first on ties).
 */
export function effectiveModifierLinks(
  categoryLinks: readonly ModifierLink[],
  productLinks: readonly ModifierLink[],
): EffectiveModifierLink[] {
  const result = new Map<string, EffectiveModifierLink>();
  for (const link of categoryLinks) {
    result.set(link.groupId, { ...link, isDisabled: false, source: 'CATEGORY' });
  }
  for (const link of productLinks) {
    if (link.isDisabled) {
      result.delete(link.groupId);
    } else {
      result.set(link.groupId, { ...link, isDisabled: false, source: 'PRODUCT' });
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || (a.source === b.source ? 0 : a.source === 'CATEGORY' ? -1 : 1),
  );
}

export interface OptionPrice {
  priceCents: number;
  sizePrices?: readonly { sizeId: string; priceCents: number }[];
}

/** Price of a modifier option for the chosen size (falls back to the default price). */
export function optionPriceForSize(option: OptionPrice, sizeId?: string | null): number {
  if (sizeId) {
    const bySize = option.sizePrices?.find((p) => p.sizeId === sizeId);
    if (bySize) return bySize.priceCents;
  }
  return option.priceCents;
}

/** Validates a link: 0 <= min <= max, max >= 1. Returns a pt-BR message or null. */
export function validateLinkLimits(minSelect: number, maxSelect: number): string | null {
  if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect)) return 'Use números inteiros';
  if (minSelect < 0) return 'O mínimo não pode ser negativo';
  if (maxSelect < 1) return 'O máximo deve ser pelo menos 1';
  if (minSelect > maxSelect) return 'O mínimo não pode ser maior que o máximo';
  return null;
}
