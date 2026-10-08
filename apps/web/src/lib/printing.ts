import type {
  PrintAgentDto,
  PrintAgentPairingCodeDto,
  PrintDocument,
  PrintJobDto,
  PrintOrderInput,
  PrintPreBillInput,
  PrintSettingsInput,
  PrintStatusDto,
  PrinterDto,
  PrinterInput,
  SectorPrintersInput,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api';

export const printKeys = {
  all: ['printing'] as const,
  status: ['printing', 'status'] as const,
  jobs: (orderId?: string) => ['printing', 'jobs', orderId ?? 'all'] as const,
  preview: (id: string) => ['printing', 'preview', id] as const,
};

/** Agents, printers, settings and alerts; refreshed by `printing.updated` and every 30 s. */
export const usePrintStatus = (enabled = true) =>
  useQuery({
    queryKey: printKeys.status,
    queryFn: () => apiGet<PrintStatusDto>('/printing/status'),
    enabled,
    // Offline agents are noticed by time (no event when a PC simply turns off).
    refetchInterval: 30_000,
  });

export const usePrintJobs = (orderId?: string, enabled = true) =>
  useQuery({
    queryKey: printKeys.jobs(orderId),
    queryFn: () =>
      apiGet<PrintJobDto[]>('/printing/jobs', { limit: 30, ...(orderId && { orderId }) }),
    enabled,
  });

export const usePrintPreview = (id: string | null) =>
  useQuery({
    queryKey: printKeys.preview(id ?? ''),
    queryFn: () =>
      apiGet<{ document: PrintDocument; paperWidth: number }>(`/printing/jobs/${id}/preview`),
    enabled: !!id,
  });

/** There is somewhere to print on paper (a usable cash printer). */
export function hasCashPrinter(status: PrintStatusDto | undefined): boolean {
  const id = status?.settings.cashPrinterId;
  return !!id && !!status?.printers.some((p) => p.id === id && p.active);
}

export const createAgent = (name: string) =>
  apiPost<PrintAgentPairingCodeDto>('/printing/agents', { name });
export const renameAgent = (id: string, name: string) =>
  apiPatch<PrintAgentDto>(`/printing/agents/${id}`, { name });
export const agentPairingCode = (id: string) =>
  apiPost<PrintAgentPairingCodeDto>(`/printing/agents/${id}/pairing-code`);
export const revokeAgent = (id: string) => apiPost<PrintAgentDto>(`/printing/agents/${id}/revoke`);

export const createPrinter = (input: PrinterInput) =>
  apiPost<PrinterDto>('/printing/printers', input);
export const updatePrinter = (id: string, input: PrinterInput) =>
  apiPatch<PrinterDto>(`/printing/printers/${id}`, input);
export const removePrinter = (id: string) => apiDelete<void>(`/printing/printers/${id}`);
export const testPrinter = (id: string) => apiPost(`/printing/printers/${id}/test`);

export const updatePrintSettings = (input: PrintSettingsInput) =>
  apiPut('/printing/settings', input);
export const updateSectorPrinters = (input: SectorPrintersInput) =>
  apiPut('/printing/sectors', input);

export const reprintJob = (id: string, printerId?: string) =>
  apiPost<PrintJobDto>(`/printing/jobs/${id}/reprint`, { ...(printerId && { printerId }) });
export const decideHeldJob = (id: string, action: 'PRINT' | 'DISCARD') =>
  apiPost<PrintJobDto>(`/printing/jobs/${id}/held`, { action });
export const retryJob = (id: string) => apiPost<PrintJobDto>(`/printing/jobs/${id}/retry`);

export const printOrder = (orderId: string, input: PrintOrderInput) =>
  apiPost<{ queued: number }>(`/printing/orders/${orderId}`, input);
export const printPreBill = (input: PrintPreBillInput) =>
  apiPost<{ queued: number }>('/printing/pre-bill', input);
export const printCashSession = (id: string) =>
  apiPost<{ queued: number }>(`/printing/cash-sessions/${id}`, {});
export const printSettlement = (id: string) =>
  apiPost<{ queued: number }>(`/printing/settlements/${id}`, {});

/** Optional link to the installer (published with each release; see docs/SETUP.md). */
export const AGENT_DOWNLOAD_URL = process.env.NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL ?? '';
