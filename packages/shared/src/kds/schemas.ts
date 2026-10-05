import { z } from 'zod';
import { zSlug } from '../schemas/common.js';

/** Request schemas of the kitchen display (D027) and KDS devices (D028). */

const zIds = (message: string) =>
  z
    .array(z.string().min(1))
    .min(1, message)
    .max(200)
    .transform((ids) => [...new Set(ids)]);

/** Start or finish tasks: one task, or a whole ticket at once. */
export const kdsTasksSchema = z.object({ taskIds: zIds('Selecione os itens') });
export type KdsTasksInput = z.input<typeof kdsTasksSchema>;

/** Expedition: rounds handed to the table/customer (dine-in and takeout). */
export const kdsServeSchema = z.object({ roundIds: zIds('Selecione a rodada') });
export type KdsServeInput = z.input<typeof kdsServeSchema>;

/** Expedition: delivery leaves with a courier (same rules as the board). */
export const kdsDispatchSchema = z.object({
  expectedVersion: z.number().int().min(0),
  courierId: z.string().min(1, 'Escolha o entregador'),
});
export type KdsDispatchInput = z.input<typeof kdsDispatchSchema>;

export const kdsBoardQuerySchema = z.object({
  /** Comma-separated sector ids (devices only see their own sectors). */
  sectors: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : [])),
});

// ---- Devices ----

export const kdsDeviceSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe um nome para a tela').max(60),
    sectorIds: z.array(z.string().min(1)).max(20).default([]),
    showsExpedition: z.boolean().default(false),
  })
  .refine((d) => d.sectorIds.length > 0 || d.showsExpedition, {
    message: 'Escolha pelo menos um setor ou a expedição',
    path: ['sectorIds'],
  });
export type KdsDeviceInput = z.input<typeof kdsDeviceSchema>;

export const KDS_PAIRING_CODE_LENGTH = 6;
/** Minutes a pairing code is valid and wrong attempts that invalidate it. */
export const KDS_PAIRING_TTL_MINUTES = 10;
export const KDS_PAIRING_MAX_FAILURES = 5;
/** Days the device credential lasts (renewed on use). */
export const KDS_DEVICE_TTL_DAYS = 180;

export const kdsPairSchema = z.object({
  store: zSlug,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 números'),
});
export type KdsPairInput = z.input<typeof kdsPairSchema>;
