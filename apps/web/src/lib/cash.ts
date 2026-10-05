import type {
  CashMovementInput,
  CashSessionDetailDto,
  CashSessionDto,
  ChangeTableInput,
  CloseCashSessionInput,
  CreatePaymentInput,
  CurrentCashDto,
  MergeSessionsInput,
  MoveItemsInput,
  OrderDetailDto,
  OrderSummaryDto,
  PixChargeDto,
  PixSettingsDto,
  PixSettingsInput,
  SplitSessionInput,
  TableDto,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from './api';

export const cashKeys = {
  all: ['cash'] as const,
  current: ['cash', 'current'] as const,
  list: (businessDate: string) => ['cash', 'list', businessDate] as const,
  detail: (id: string) => ['cash', 'detail', id] as const,
  receivables: ['orders', 'receivables'] as const,
  pix: (orderId: string, amountCents: number) => ['orders', 'pix', orderId, amountCents] as const,
  pixSettings: ['store', 'pix'] as const,
};

// ---- Cash register ----

export const useCurrentCash = (enabled = true) =>
  useQuery({
    queryKey: cashKeys.current,
    queryFn: () => apiGet<CurrentCashDto>('/cash-sessions/current'),
    enabled,
  });

export const useCashSessions = (businessDate: string, enabled = true) =>
  useQuery({
    queryKey: cashKeys.list(businessDate),
    queryFn: () => apiGet<CashSessionDto[]>('/cash-sessions', { businessDate }),
    enabled,
  });

export const useCashSession = (id: string | null) =>
  useQuery({
    queryKey: cashKeys.detail(id ?? ''),
    queryFn: () => apiGet<CashSessionDetailDto>(`/cash-sessions/${id}`),
    enabled: !!id,
  });

export const openCashSession = (openingCents: number) =>
  apiPost<CashSessionDetailDto>('/cash-sessions', { openingCents });

export const addCashMovement = (input: CashMovementInput) =>
  apiPost<CashSessionDetailDto>('/cash-sessions/current/movements', input);

export const closeCashSession = (id: string, input: CloseCashSessionInput) =>
  apiPost<CashSessionDetailDto>(`/cash-sessions/${id}/close`, input);

export const reopenCashSession = (
  session: Pick<CashSessionDto, 'id' | 'version'>,
  reason: string,
) =>
  apiPost<CashSessionDetailDto>(`/cash-sessions/${session.id}/reopen`, {
    expectedVersion: session.version,
    reason,
  });

// ---- Payments ----

/** Delivered deliveries with an open balance (the courier still has to settle). */
export const useReceivables = (enabled = true) =>
  useQuery({
    queryKey: cashKeys.receivables,
    queryFn: () => apiGet<OrderSummaryDto[]>('/orders', { receivable: true }),
    enabled,
  });

export const createPayment = (
  order: Pick<OrderDetailDto, 'id' | 'version'>,
  input: Omit<CreatePaymentInput, 'expectedVersion'>,
) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/payments`, {
    ...input,
    expectedVersion: order.version,
  });

export const refundPayment = (
  order: Pick<OrderDetailDto, 'id' | 'version'>,
  paymentId: string,
  reason: string,
) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/payments/${paymentId}/refund`, {
    expectedVersion: order.version,
    reason,
  });

export const usePixCharge = (orderId: string, amountCents: number, enabled: boolean) =>
  useQuery({
    queryKey: cashKeys.pix(orderId, amountCents),
    queryFn: () => apiGet<PixChargeDto>(`/orders/${orderId}/pix`, { amountCents }),
    enabled: enabled && amountCents > 0,
    retry: false,
  });

export const usePixSettings = (enabled = true) =>
  useQuery({
    queryKey: cashKeys.pixSettings,
    queryFn: () => apiGet<PixSettingsDto>('/stores/current/pix'),
    enabled,
  });

export const updatePixSettings = (input: PixSettingsInput) =>
  apiPatch<PixSettingsDto>('/stores/current/pix', input);

// ---- Tabs and tables ----

export const moveOrderItems = (
  order: Pick<OrderDetailDto, 'id' | 'version'>,
  input: Omit<MoveItemsInput, 'expectedVersion'>,
) =>
  apiPost<{ source: OrderDetailDto; target: OrderDetailDto }>(`/orders/${order.id}/move-items`, {
    ...input,
    expectedVersion: order.version,
  });

export const transferOrder = (order: Pick<OrderDetailDto, 'id' | 'version'>, tableId: string) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/transfer`, {
    expectedVersion: order.version,
    tableId,
  });

export const changeTable = (sessionId: string, input: ChangeTableInput) =>
  apiPost<TableDto[]>(`/tables/sessions/${sessionId}/change-table`, input);

export const mergeTables = (sessionId: string, input: MergeSessionsInput) =>
  apiPost<TableDto[]>(`/tables/sessions/${sessionId}/merge`, input);

export const splitTables = (sessionId: string, input: SplitSessionInput) =>
  apiPost<TableDto[]>(`/tables/sessions/${sessionId}/split`, input);

export const requestBill = (sessionId: string) =>
  apiPost<TableDto[]>(`/tables/sessions/${sessionId}/bill-request`);
