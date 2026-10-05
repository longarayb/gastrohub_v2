import { z } from 'zod';
import { SALES_CHANNELS, type SalesChannel } from '../domain/menu-availability.js';
import { DEFAULT_SECTOR_LATE_MINUTES, DEFAULT_SECTOR_WARN_MINUTES } from '../domain/kds.js';
import { validateLinkLimits } from '../domain/menu-modifiers.js';
import { zCents } from '../schemas/common.js';
import { businessHourSchema } from '../stores/schemas.js';

/** Request schemas of the menu module (API validation + admin forms). */

const zName = z.string().trim().min(1, 'Informe o nome').max(120, 'Nome muito longo');
const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);
const zCode = zOptionalText(40);
const zOptionalCents = zCents
  .optional()
  .nullable()
  .transform((v) => v ?? null);

export const zSalesChannel = z.enum(SALES_CHANNELS as [SalesChannel, ...SalesChannel[]]);
export const zChannels = z
  .array(zSalesChannel)
  .min(1, 'Selecione pelo menos um canal de venda')
  .transform((list) => [...new Set(list)]);

export const zSchedules = z.array(businessHourSchema).max(28).default([]);

/** Promo must be lower than the full price. */
const promoRefine = <T extends { priceCents?: number | null; promoPriceCents?: number | null }>(
  v: T,
) => v.promoPriceCents == null || v.priceCents == null || v.promoPriceCents < v.priceCents;
const promoMessage = {
  message: 'O preço promocional deve ser menor que o preço normal',
  path: ['promoPriceCents'],
};

// ---- Sectors ----
export const sectorSchema = z
  .object({
    name: zName,
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
    /** KDS timer alerts in minutes since the ticket was sent (yellow, red). */
    warnAfterMinutes: z.number().int().min(1).max(240).default(DEFAULT_SECTOR_WARN_MINUTES),
    lateAfterMinutes: z.number().int().min(2).max(480).default(DEFAULT_SECTOR_LATE_MINUTES),
  })
  .refine((s) => s.lateAfterMinutes > s.warnAfterMinutes, {
    message: 'O alerta vermelho deve vir depois do amarelo',
    path: ['lateAfterMinutes'],
  });
export type SectorInput = z.input<typeof sectorSchema>;

// ---- Pause / reorder ----
export const pauseSchema = z.object({
  /** END_OF_DAY = "Acabou" (until the end of the business day); INDEFINITE = until resumed. */
  mode: z.enum(['END_OF_DAY', 'INDEFINITE']).default('END_OF_DAY'),
});
export type PauseInput = z.input<typeof pauseSchema>;

export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});
export type ReorderInput = z.input<typeof reorderSchema>;

// ---- Modifier links ----
export const modifierLinkSchema = z
  .object({
    groupId: z.string().min(1),
    minSelect: z.number().int().default(0),
    maxSelect: z.number().int().default(1),
    isDisabled: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.isDisabled) return;
    const error = validateLinkLimits(v.minSelect, v.maxSelect);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['maxSelect'] });
  });
export type ModifierLinkInput = z.input<typeof modifierLinkSchema>;

/** Order of the array = display order. */
export const modifierLinksSchema = z
  .array(modifierLinkSchema)
  .max(30)
  .default([])
  .refine((links) => new Set(links.map((l) => l.groupId)).size === links.length, {
    message: 'Grupo de complementos repetido',
  });

// ---- Categories ----
export const zCategoryKind = z.enum(['STANDARD', 'PIZZA']);

export const categorySchema = z.object({
  name: zName,
  description: zOptionalText(500),
  kind: zCategoryKind.default('STANDARD'),
  channels: zChannels.default([...SALES_CHANNELS]),
  schedules: zSchedules,
  modifierLinks: modifierLinksSchema,
});
export type CategoryInput = z.input<typeof categorySchema>;

export const pizzaSizeSchema = z.object({
  id: z.string().optional(),
  name: zName,
  maxFlavors: z.number().int().min(1, 'Mínimo 1 sabor').max(8, 'Máximo 8 sabores'),
  slices: z.number().int().min(1).max(32).optional().nullable(),
  externalCode: zCode,
});
export const categorySizesSchema = z.object({
  sizes: z.array(pizzaSizeSchema).min(1, 'Cadastre pelo menos um tamanho').max(10),
});
export type CategorySizesInput = z.input<typeof categorySizesSchema>;

// ---- Products ----
export const zProductKind = z.enum(['STANDARD', 'SIZED']);

const productSizeSchema = z
  .object({
    id: z.string().optional(),
    name: zName,
    priceCents: zCents,
    promoPriceCents: zOptionalCents,
    externalCode: zCode,
  })
  .refine(promoRefine, promoMessage);

const flavorPriceSchema = z
  .object({
    sizeId: z.string().min(1),
    priceCents: zCents,
    promoPriceCents: zOptionalCents,
  })
  .refine(promoRefine, promoMessage);

/**
 * Product create/update. Pricing depends on the category and kind:
 * - STANDARD in a STANDARD category → `priceCents`
 * - SIZED → `sizes` (own sizes with prices)
 * - any product in a PIZZA category is a flavor → `flavorPrices` for the category sizes
 * The API checks the category-dependent rules.
 */
export const productSchema = z
  .object({
    categoryId: z.string().min(1, 'Selecione a categoria'),
    kind: zProductKind.default('STANDARD'),
    name: zName,
    description: zOptionalText(1000),
    priceCents: zOptionalCents,
    promoPriceCents: zOptionalCents,
    sku: zCode,
    externalCode: zCode,
    sectorId: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v || null),
    channels: zChannels.default([...SALES_CHANNELS]),
    schedules: zSchedules,
    sizes: z.array(productSizeSchema).max(10).default([]),
    flavorPrices: z.array(flavorPriceSchema).max(10).default([]),
    modifierLinks: modifierLinksSchema,
  })
  .refine(promoRefine, promoMessage);
export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().optional(),
  status: z.enum(['all', 'active', 'paused']).default('all'),
  channel: zSalesChannel.optional(),
  sectorId: z.string().optional(),
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

// ---- Modifier groups ----
const modifierOptionSchema = z.object({
  id: z.string().optional(),
  /** Ignored for combo options (the product name is used). */
  name: z.string().trim().max(120).default(''),
  priceCents: zCents.default(0),
  maxQuantity: z.number().int().min(1).max(20).default(1),
  productId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  sku: zCode,
  externalCode: zCode,
  sizePrices: z
    .array(z.object({ sizeId: z.string().min(1), priceCents: zCents }))
    .max(10)
    .default([]),
});

export const modifierGroupSchema = z.object({
  name: zName,
  description: zOptionalText(300),
  options: z
    .array(modifierOptionSchema)
    .min(1, 'Cadastre pelo menos uma opção')
    .max(100)
    .superRefine((options, ctx) => {
      options.forEach((o, i) => {
        if (!o.productId && !o.name) {
          ctx.addIssue({ code: 'custom', message: 'Informe o nome da opção', path: [i, 'name'] });
        }
      });
    }),
});
export type ModifierGroupInput = z.input<typeof modifierGroupSchema>;
export type ModifierGroupData = z.output<typeof modifierGroupSchema>;
