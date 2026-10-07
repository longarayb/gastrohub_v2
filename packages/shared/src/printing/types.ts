import type { PaperWidth, PrintDocument } from '../domain/printing.js';
import type { PrintJobKind, PrintJobStatus, PrinterConnection, PrinterStatus } from './schemas.js';

/** Response DTOs of printing. Dates are ISO strings. */

export type PrintAgentState = 'PENDING' | 'PAIRED' | 'REVOKED';

export interface PrintAgentDto {
  id: string;
  name: string;
  state: PrintAgentState;
  /** Heartbeat in the last 90 seconds. */
  online: boolean;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  version: string | null;
  hostname: string | null;
  os: string | null;
  memoryMb: number | null;
  windowsPrinters: string[];
  createdAt: string;
}

/** Returned once, when a pairing code is generated (never stored in clear). */
export interface PrintAgentPairingCodeDto {
  agent: PrintAgentDto;
  code: string;
  storeSlug: string;
  expiresAt: string;
}

export interface PrinterDto {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  connection: PrinterConnection;
  address: string;
  profileId: string;
  paperWidth: PaperWidth;
  withoutAccents: boolean;
  active: boolean;
  status: PrinterStatus;
  statusDetail: string | null;
  statusAt: string | null;
  /** Sectors that print here, with their copies. */
  sectors: { id: string; name: string; copies: number }[];
  isCashPrinter: boolean;
}

export interface PrintSettingsDto {
  cashPrinterId: string | null;
  deliveryCopyOnAccept: boolean;
  deliveryCopies: number;
  cancelSlips: boolean;
  holdAfterMinutes: number;
}

export interface SectorPrinterDto {
  sectorId: string;
  name: string;
  printerId: string | null;
  copies: number;
}

export interface PrintJobDto {
  id: string;
  kind: PrintJobKind;
  status: PrintJobStatus;
  title: string;
  printerId: string;
  printerName: string;
  copies: number;
  attempts: number;
  lastError: string | null;
  orderId: string | null;
  orderNumber: number | null;
  reprintOfId: string | null;
  createdAt: string;
  printedAt: string | null;
  /** Failing for a while (agent or printer problem): shown as an alert. */
  failing: boolean;
}

/** Panel summary: what is wrong right now (badge in the shell) and the setup. */
export interface PrintStatusDto {
  agents: PrintAgentDto[];
  printers: PrinterDto[];
  settings: PrintSettingsDto;
  sectors: SectorPrinterDto[];
  held: PrintJobDto[];
  failing: PrintJobDto[];
  /** Count for the alert badge: offline agents with printers, printers with problems, held/failing jobs. */
  alerts: number;
  serverTime: string;
}

/** A printer as the agent needs it to print. */
export interface AgentPrinterDto {
  id: string;
  name: string;
  connection: PrinterConnection;
  address: string;
  profileId: string;
  paperWidth: PaperWidth;
  withoutAccents: boolean;
}

/** What the agent receives after pairing or renewing its session. */
export interface PrintAgentSessionDto {
  accessToken: string;
  /** Long-lived credential, kept encrypted by Windows (DPAPI); sent only to renew the session. */
  refreshToken?: string;
  expiresIn: number;
  agent: { id: string; name: string };
  store: { id: string; name: string; slug: string };
  printers: AgentPrinterDto[];
}

export interface LeasedPrintJobDto {
  id: string;
  attempt: number;
  kind: PrintJobKind;
  printer: AgentPrinterDto;
  copies: number;
  /** Already with the late / possible duplicate / reprint marks. */
  document: PrintDocument;
}

export interface PrintLeaseDto {
  jobs: LeasedPrintJobDto[];
  printers: AgentPrinterDto[];
}
