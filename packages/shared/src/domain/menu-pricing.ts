/**
 * Menu item pricing and snapshot. Pure functions shared by the API (source of truth),
 * the POS and the digital menu. All amounts are integer cents.
 */

export const PizzaPricingRule = { HIGHEST: 'HIGHEST', AVERAGE: 'AVERAGE' } as const;
export type PizzaPricingRule = (typeof PizzaPricingRule)[keyof typeof PizzaPricingRule];

export const PIZZA_PRICING_RULE_LABELS: Record<PizzaPricingRule, string> = {
  HIGHEST: 'Maior valor entre os sabores',
  AVERAGE: 'Média dos sabores',
};

export interface PriceTag {
  priceCents: number;
  /** Promotional price; applies only when lower than `priceCents`. */
  promoPriceCents?: number | null;
}

/** Price actually charged for a price tag (promo when valid). */
export function chargedPrice(tag: PriceTag): number {
  const promo = tag.promoPriceCents;
  return promo != null && promo >= 0 && promo < tag.priceCents ? promo : tag.priceCents;
}

/** Combines flavor prices of a pizza: highest, or average rounded up to the cent. */
export function combinePizzaPrices(prices: readonly number[], rule: PizzaPricingRule): number {
  if (prices.length === 0) throw new RangeError('A pizza precisa de pelo menos um sabor');
  if (rule === PizzaPricingRule.HIGHEST) return Math.max(...prices);
  return Math.ceil(prices.reduce((sum, p) => sum + p, 0) / prices.length);
}

// ---------------------------------------------------------------------------
// Modifier selection rules

export interface ModifierGroupRule {
  groupId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { optionId: string; name: string; maxQuantity: number }[];
}

export interface ModifierSelection {
  groupId: string;
  optionId: string;
  quantity: number;
}

/**
 * Validates the chosen modifiers against the effective groups of a product.
 * Quantities count towards min/max (2x bacon = 2). Returns pt-BR messages; empty = valid.
 */
export function validateModifierSelections(
  groups: readonly ModifierGroupRule[],
  selections: readonly ModifierSelection[],
): string[] {
  const errors: string[] = [];
  const groupsById = new Map(groups.map((g) => [g.groupId, g]));

  for (const s of selections) {
    const group = groupsById.get(s.groupId);
    const option = group?.options.find((o) => o.optionId === s.optionId);
    if (!group || !option) {
      errors.push('Complemento inválido para este produto');
      continue;
    }
    if (!Number.isInteger(s.quantity) || s.quantity < 1) {
      errors.push(`Quantidade inválida em "${option.name}"`);
    } else if (s.quantity > option.maxQuantity) {
      errors.push(`"${option.name}" permite no máximo ${option.maxQuantity}`);
    }
  }

  const repeated = selections.filter(
    (s, i) =>
      selections.findIndex((o) => o.groupId === s.groupId && o.optionId === s.optionId) !== i,
  );
  if (repeated.length) errors.push('Complemento repetido; ajuste a quantidade');

  for (const group of groups) {
    const count = selections
      .filter((s) => s.groupId === group.groupId)
      .reduce((sum, s) => sum + Math.max(0, s.quantity), 0);
    if (count < group.minSelect) {
      errors.push(
        group.minSelect === 1
          ? `Escolha uma opção em "${group.name}"`
          : `Escolha pelo menos ${group.minSelect} opções em "${group.name}"`,
      );
    }
    if (count > group.maxSelect) {
      errors.push(
        group.maxSelect === 1
          ? `Escolha apenas uma opção em "${group.name}"`
          : `Escolha no máximo ${group.maxSelect} opções em "${group.name}"`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Pricing input

export interface ProductRef {
  id: string;
  name: string;
  sku?: string | null;
  sectorId?: string | null;
}

export interface PricedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  /** Option name; for combo options, the name of the referenced product. */
  name: string;
  quantity: number;
  /** Price of one unit of the option (already resolved for the chosen size). */
  unitPriceCents: number;
  /** Combo option referencing a menu product (e.g. "Escolha a bebida"). */
  product?: ProductRef | null;
  /** Sector of this modifier (referenced product's sector); defaults to the item's. */
  sectorId?: string | null;
}

export interface PizzaFlavorInput extends PriceTag {
  product: ProductRef;
  /** Free note for this flavor ("sem cebola"). */
  note?: string | null;
}

interface CommonInput {
  modifiers?: readonly PricedModifier[];
  quantity?: number;
  note?: string | null;
}

export interface SimpleItemInput extends CommonInput, PriceTag {
  kind: 'STANDARD' | 'SIZED';
  product: ProductRef;
  categoryId?: string | null;
  /** Required for SIZED products. */
  size?: { id: string; name: string } | null;
}

export interface PizzaItemInput extends CommonInput {
  kind: 'PIZZA';
  category: { id: string; name: string };
  size: { id: string; name: string; maxFlavors: number };
  /** Flavors with their prices for the chosen size. */
  flavors: readonly PizzaFlavorInput[];
  rule: PizzaPricingRule;
}

export type MenuItemInput = SimpleItemInput | PizzaItemInput;

// ---------------------------------------------------------------------------
// Snapshot (stored by order items; never depends on the current menu)

export interface SnapshotFlavor {
  productId: string;
  name: string;
  fraction: { numerator: number; denominator: number };
  fullPriceCents: number;
  chargedPriceCents: number;
  note: string | null;
}

export interface SnapshotModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  product: { id: string; name: string; sectorId: string | null } | null;
  sectorId: string | null;
}

export interface MenuItemSnapshot {
  version: 1;
  kind: 'STANDARD' | 'SIZED' | 'PIZZA';
  /** Display name at the time of sale ("X-Burger", "Pizzas — Grande"). */
  name: string;
  productId: string | null;
  categoryId: string | null;
  sku: string | null;
  sectorId: string | null;
  size: { id: string; name: string } | null;
  flavors: SnapshotFlavor[];
  pizzaPricingRule: PizzaPricingRule | null;
  /** Base price (product/size or combined flavors), before modifiers. */
  baseFullPriceCents: number;
  baseChargedPriceCents: number;
  modifiers: SnapshotModifier[];
  /** Unit price without promotions (base full + modifiers). */
  unitFullPriceCents: number;
  /** Unit price actually charged (base charged + modifiers). */
  unitChargedPriceCents: number;
  note: string | null;
}

export interface MenuItemPricing {
  snapshot: MenuItemSnapshot;
  quantity: number;
  unitFullPriceCents: number;
  unitChargedPriceCents: number;
  totalFullCents: number;
  totalChargedCents: number;
  /** Savings from promotions on this line. */
  promoDiscountCents: number;
}

function assertCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} inválido`);
}

/** Prices a menu item and builds its immutable snapshot. Throws RangeError on invalid input. */
export function priceMenuItem(input: MenuItemInput): MenuItemPricing {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError('Quantidade inválida');

  let snapshotBase: Omit<
    MenuItemSnapshot,
    'modifiers' | 'unitFullPriceCents' | 'unitChargedPriceCents' | 'note' | 'version'
  >;

  if (input.kind === 'PIZZA') {
    const n = input.flavors.length;
    if (n < 1) throw new RangeError('Escolha pelo menos um sabor');
    if (n > input.size.maxFlavors) {
      throw new RangeError(
        `O tamanho ${input.size.name} permite até ${input.size.maxFlavors} sabores`,
      );
    }
    const ids = input.flavors.map((f) => f.product.id);
    if (new Set(ids).size !== n) throw new RangeError('Sabor repetido na pizza');

    const flavors: SnapshotFlavor[] = input.flavors.map((f) => {
      assertCents(f.priceCents, 'Preço do sabor');
      return {
        productId: f.product.id,
        name: f.product.name,
        fraction: { numerator: 1, denominator: n },
        fullPriceCents: f.priceCents,
        chargedPriceCents: chargedPrice(f),
        note: f.note?.trim() || null,
      };
    });
    snapshotBase = {
      kind: 'PIZZA',
      name: `${input.category.name} — ${input.size.name}`,
      productId: null,
      categoryId: input.category.id,
      sku: null,
      sectorId: input.flavors[0]?.product.sectorId ?? null,
      size: { id: input.size.id, name: input.size.name },
      flavors,
      pizzaPricingRule: input.rule,
      baseFullPriceCents: combinePizzaPrices(
        flavors.map((f) => f.fullPriceCents),
        input.rule,
      ),
      baseChargedPriceCents: combinePizzaPrices(
        flavors.map((f) => f.chargedPriceCents),
        input.rule,
      ),
    };
  } else {
    assertCents(input.priceCents, 'Preço');
    if (input.kind === 'SIZED' && !input.size) throw new RangeError('Escolha o tamanho');
    snapshotBase = {
      kind: input.kind,
      name: input.size ? `${input.product.name} ${input.size.name}` : input.product.name,
      productId: input.product.id,
      categoryId: input.categoryId ?? null,
      sku: input.product.sku ?? null,
      sectorId: input.product.sectorId ?? null,
      size: input.size ? { id: input.size.id, name: input.size.name } : null,
      flavors: [],
      pizzaPricingRule: null,
      baseFullPriceCents: input.priceCents,
      baseChargedPriceCents: chargedPrice(input),
    };
  }

  const modifiers: SnapshotModifier[] = (input.modifiers ?? []).map((m) => {
    assertCents(m.unitPriceCents, `Preço de "${m.name}"`);
    if (!Number.isInteger(m.quantity) || m.quantity < 1) {
      throw new RangeError(`Quantidade inválida em "${m.name}"`);
    }
    return {
      groupId: m.groupId,
      groupName: m.groupName,
      optionId: m.optionId,
      name: m.product?.name ?? m.name,
      quantity: m.quantity,
      unitPriceCents: m.unitPriceCents,
      totalCents: m.unitPriceCents * m.quantity,
      product: m.product
        ? { id: m.product.id, name: m.product.name, sectorId: m.product.sectorId ?? null }
        : null,
      sectorId: m.sectorId ?? m.product?.sectorId ?? snapshotBase.sectorId,
    };
  });
  const modifiersCents = modifiers.reduce((sum, m) => sum + m.totalCents, 0);

  const unitFullPriceCents = snapshotBase.baseFullPriceCents + modifiersCents;
  const unitChargedPriceCents = snapshotBase.baseChargedPriceCents + modifiersCents;

  const snapshot: MenuItemSnapshot = {
    version: 1,
    ...snapshotBase,
    modifiers,
    unitFullPriceCents,
    unitChargedPriceCents,
    note: input.note?.trim() || null,
  };

  return {
    snapshot,
    quantity,
    unitFullPriceCents,
    unitChargedPriceCents,
    totalFullCents: unitFullPriceCents * quantity,
    totalChargedCents: unitChargedPriceCents * quantity,
    promoDiscountCents: (unitFullPriceCents - unitChargedPriceCents) * quantity,
  };
}
