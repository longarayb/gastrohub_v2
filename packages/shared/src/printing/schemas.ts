import { z } from 'zod';
import { PAPER_WIDTHS, PRINTER_PROFILES } from '../domain/printing.js';
import { zSlug } from '../schemas/common.js';

/** Request schemas of printing (D035–D037): agents, printers, settings and the print queue. */

export const PRINTER_CONNECTIONS = ['NETWORK', 'USB', 'SHARED', 'VIRTUAL'] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];

export const PRINTER_CONNECTION_LABELS: Record<PrinterConnection, string> = {
  NETWORK: 'Rede (IP)',
  USB: 'USB (instalada no Windows)',
  SHARED: 'Compartilhada na rede',
  VIRTUAL: 'Virtual (arquivo, para testes)',
};

export const PRINTER_STATUSES = ['UNKNOWN', 'OK', 'PAPER_OUT', 'OFFLINE', 'ERROR'] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

export const PRINTER_STATUS_LABELS: Record<PrinterStatus, string> = {
  UNKNOWN: 'Sem informação',
  OK: 'Pronta',
  PAPER_OUT: 'Sem papel',
  OFFLINE: 'Desligada ou sem conexão',
  ERROR: 'Com erro',
};

export const PRINT_JOB_KINDS = [
  'KITCHEN_TICKET',
  'CANCEL_SLIP',
  'DELIVERY_COPY',
  'PRE_BILL',
  'CASH_CLOSE',
  'COURIER_SETTLEMENT',
  'TEST_PAGE',
] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

export const PRINT_JOB_KIND_LABELS: Record<PrintJobKind, string> = {
  KITCHEN_TICKET: 'Comanda de produção',
  CANCEL_SLIP: 'Aviso de cancelamento',
  DELIVERY_COPY: 'Via de entrega',
  PRE_BILL: 'Pré-conta',
  CASH_CLOSE: 'Fechamento de caixa',
  COURIER_SETTLEMENT: 'Acerto do entregador',
  TEST_PAGE: 'Página de teste',
};

/**
 * PENDING waits for the agent (retries keep it PENDING with `lastError`), LEASED is with the agent,
 * HELD is too old to print on its own (someone decides: print or discard).
 */
export const PRINT_JOB_STATUSES = ['PENDING', 'LEASED', 'PRINTED', 'HELD', 'DISCARDED'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export const PRINT_JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  PENDING: 'Na fila',
  LEASED: 'Imprimindo',
  PRINTED: 'Impresso',
  HELD: 'Retido (antigo)',
  DISCARDED: 'Descartado',
};

const PROFILE_IDS = PRINTER_PROFILES.map((p) => p.id);
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** "192.168.0.50" or "192.168.0.50:9100" (also a host name); the port defaults to 9100. */
export function parseNetworkAddress(address: string): { host: string; port: number } | null {
  const match = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(address.trim());
  if (!match) return null;
  const host = match[1]!;
  const port = match[2] ? Number(match[2]) : 9100;
  if (port < 1 || port > 65_535) return null;
  if (!IPV4.test(host) && (/^[\d.]+$/.test(host) || !HOSTNAME.test(host))) return null;
  return { host, port };
}

/** "\\PC-CAIXA\Cozinha": the computer and the share name of a printer shared in Windows. */
export const isSharedPrinterPath = (address: string): boolean =>
  /^\\\\[^\\/:*?"<>|\s]+\\[^\\/:*?"<>|]+$/.test(address.trim());

export const printerSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe um nome para a impressora').max(60),
    agentId: z.string().min(1, 'Escolha o computador que imprime'),
    connection: z.enum(PRINTER_CONNECTIONS),
    /** IP[:port], Windows printer name or \\PC\share (empty for VIRTUAL). */
    address: z.string().trim().max(200).default(''),
    profileId: z.string().refine((id) => PROFILE_IDS.includes(id), 'Modelo desconhecido'),
    paperWidth: z.union(PAPER_WIDTHS.map((w) => z.literal(w))),
    /** Last resort for printers that print wrong characters with every code page. */
    withoutAccents: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['address'] });
    if (p.connection === 'NETWORK' && !parseNetworkAddress(p.address)) {
      issue('Informe o IP da impressora (ex.: 192.168.0.50 ou 192.168.0.50:9100)');
    }
    if (p.connection === 'USB' && p.address.length < 2) {
      issue('Escolha a impressora instalada no Windows');
    }
    if (p.connection === 'SHARED' && !isSharedPrinterPath(p.address)) {
      issue('Informe o caminho compartilhado (ex.: \\\\PC-CAIXA\\Cozinha)');
    }
  });
export type PrinterInput = z.input<typeof printerSchema>;

export const MAX_PRINT_COPIES = 3;
const zCopies = z.number().int().min(1, 'Mínimo 1 via').max(MAX_PRINT_COPIES, 'Máximo 3 vias');

/** Which printer each production sector uses and how many copies (empty printer = no ticket). */
export const sectorPrintersSchema = z.object({
  sectors: z
    .array(
      z.object({
        sectorId: z.string().min(1),
        printerId: z.string().min(1).nullable(),
        copies: zCopies,
      }),
    )
    .max(50),
});
export type SectorPrintersInput = z.input<typeof sectorPrintersSchema>;

/** Minutes after which an unprinted job waits for a decision instead of printing on its own. */
export const DEFAULT_PRINT_HOLD_MINUTES = 30;

export const printSettingsSchema = z.object({
  /** Pre-bill, delivery copy, cash close and courier settlement. */
  cashPrinterId: z.string().min(1).nullable(),
  /** Delivery copy printed when a delivery order is accepted (D036). */
  deliveryCopyOnAccept: z.boolean(),
  deliveryCopies: zCopies,
  /** "CANCELADO" slip to the sector that had the ticket. */
  cancelSlips: z.boolean(),
  holdAfterMinutes: z
    .number()
    .int()
    .min(5, 'Mínimo 5 minutos')
    .max(240, 'Máximo 240 minutos (4 horas)'),
});
export type PrintSettingsInput = z.input<typeof printSettingsSchema>;

// ---- Agents ----

export const printAgentSchema = z.object({
  name: z.string().trim().min(2, 'Informe um nome para o computador').max(60),
});
export type PrintAgentInput = z.input<typeof printAgentSchema>;

/** Pairing uses the same code length, expiry and attempt limit of the kitchen screens. */
export const printAgentPairSchema = z.object({
  store: zSlug,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 números'),
  hostname: z.string().trim().max(100).optional(),
  version: z.string().trim().max(30).optional(),
});
export type PrintAgentPairInput = z.input<typeof printAgentPairSchema>;

/** Days the agent credential lasts (renewed on use, revocable in the panel). */
export const PRINT_AGENT_TTL_DAYS = 365;

/** The agent exchanges its stored credential for a short access token. */
export const printAgentSessionSchema = z.object({ token: z.string().min(20).max(200) });

export const printAgentHeartbeatSchema = z.object({
  version: z.string().trim().max(30),
  hostname: z.string().trim().max(100),
  os: z.string().trim().max(100).optional(),
  /** Resident memory of the agent process, to check the target on modest PCs. */
  memoryMb: z.number().min(0).max(100_000),
  /** Printers installed in Windows (to choose a USB printer in the panel). */
  windowsPrinters: z.array(z.string().max(200)).max(100).default([]),
  printers: z
    .array(
      z.object({
        id: z.string().min(1),
        status: z.enum(PRINTER_STATUSES),
        detail: z.string().max(300).optional(),
      }),
    )
    .max(50)
    .default([]),
});
export type PrintAgentHeartbeatInput = z.input<typeof printAgentHeartbeatSchema>;

export const printLeaseSchema = z.object({
  max: z.number().int().min(1).max(20).default(10),
});
export type PrintLeaseInput = z.input<typeof printLeaseSchema>;

/** Seconds a leased job stays with the agent before it goes back to the queue. */
export const PRINT_LEASE_SECONDS = 60;

export const printAckSchema = z
  .object({
    /** Attempt number received in the lease (late acks of an expired lease are ignored). */
    attempt: z.number().int().min(1),
    result: z.enum(['PRINTED', 'FAILED']),
    error: z.string().trim().max(300).optional(),
    printerStatus: z.enum(PRINTER_STATUSES).optional(),
  })
  .refine((a) => a.result === 'PRINTED' || !!a.error, {
    message: 'Informe o erro',
    path: ['error'],
  });
export type PrintAckInput = z.input<typeof printAckSchema>;

// ---- Panel ----

export const printJobsQuerySchema = z.object({
  status: z.enum(PRINT_JOB_STATUSES).optional(),
  orderId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Held job: print now (marked as late) or discard. */
export const printHeldDecisionSchema = z.object({
  action: z.enum(['PRINT', 'DISCARD']),
});
export type PrintHeldDecisionInput = z.input<typeof printHeldDecisionSchema>;

/** Documents printed on demand; without a printer, the store's cash printer is used. */
export const printTargetSchema = z.object({
  printerId: z.string().min(1).optional(),
});
export type PrintTargetInput = z.input<typeof printTargetSchema>;

/** Delivery copy, or a second copy of the production tickets of an order. */
export const printOrderSchema = printTargetSchema.extend({
  document: z.enum(['DELIVERY_COPY', 'KITCHEN_TICKETS']),
});
export type PrintOrderInput = z.input<typeof printOrderSchema>;

/** Pre-bill of a table: chosen tabs, optional even split and PIX QR Code (one tab only). */
export const printPreBillSchema = printTargetSchema.extend({
  orderIds: z
    .array(z.string().min(1))
    .min(1, 'Selecione as contas')
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  people: z.number().int().min(1).max(30).default(1),
  withPix: z.boolean().default(false),
});
export type PrintPreBillInput = z.input<typeof printPreBillSchema>;
