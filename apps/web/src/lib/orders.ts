import type {
  AddItemsInput,
  AreaDto,
  CouponDto,
  CouponInput,
  CourierDto,
  CreateOrderInput,
  CustomerDto,
  CustomerInput,
  DiscountData,
  OrderDetailDto,
  OrderStatus,
  OrderSummaryDto,
  OrderType,
  RejectOrderInput,
  TableDto,
  TableInput,
} from '@app/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet, apiPatch, apiPost } from './api';

export const orderKeys = {
  all: ['orders'] as const,
  board: ['orders', 'board'] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  tables: ['tables'] as const,
  areas: ['tables', 'areas'] as const,
  customers: (q: string) => ['customers', q] as const,
  couriers: ['couriers'] as const,
  coupons: ['coupons'] as const,
};

/** Open orders plus the ones finished in the last hours (kanban). */
export const useOrderBoard = () =>
  useQuery({
    queryKey: orderKeys.board,
    queryFn: () => apiGet<OrderSummaryDto[]>('/orders', { board: true }),
  });

export const useOrder = (id: string | null) =>
  useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => apiGet<OrderDetailDto>(`/orders/${id}`),
    enabled: !!id,
  });

export const useTables = () =>
  useQuery({ queryKey: orderKeys.tables, queryFn: () => apiGet<TableDto[]>('/tables') });

export const useAreas = () =>
  useQuery({ queryKey: orderKeys.areas, queryFn: () => apiGet<AreaDto[]>('/tables/areas') });

export const useCustomerSearch = (q: string) =>
  useQuery({
    queryKey: orderKeys.customers(q),
    queryFn: () => apiGet<CustomerDto[]>('/customers', { q }),
    enabled: q.trim().length >= 3,
    placeholderData: (previous) => previous,
  });

export const useCouriers = (enabled = true) =>
  useQuery({
    queryKey: orderKeys.couriers,
    queryFn: () => apiGet<CourierDto[]>('/couriers'),
    enabled,
  });

export const useCoupons = (enabled = true) =>
  useQuery({
    queryKey: orderKeys.coupons,
    queryFn: () => apiGet<CouponDto[]>('/coupons'),
    enabled,
  });

/** Invalidates order lists, details and tables (after a mutation or a realtime event). */
export function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orderKeys.all }),
      queryClient.invalidateQueries({ queryKey: orderKeys.tables }),
    ]);
}

// ---- Mutations (every change sends the version the user saw: 409 if stale) ----

export const createOrder = (input: CreateOrderInput, idempotencyKey: string) =>
  api<OrderDetailDto>('/orders', {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const addOrderItems = (id: string, input: AddItemsInput) =>
  apiPost<OrderDetailDto>(`/orders/${id}/items`, input);

export const sendOrderRound = (order: OrderDetailDto) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/send`, { expectedVersion: order.version });

export const removeDraftItem = (order: OrderDetailDto, itemId: string) =>
  api<OrderDetailDto>(`/orders/${order.id}/items/${itemId}`, {
    method: 'DELETE',
    query: { expectedVersion: order.version },
  });

export const cancelOrderItem = (order: OrderDetailDto, itemId: string, reason: string | null) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/items/${itemId}/cancel`, {
    expectedVersion: order.version,
    reason,
  });

export const changeOrderStatus = (
  order: Pick<OrderSummaryDto, 'id' | 'version'>,
  status: OrderStatus,
  reason?: string,
) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/status`, {
    expectedVersion: order.version,
    status,
    reason,
  });

export const setOrderDiscount = (
  order: OrderDetailDto,
  discount: DiscountData | null,
  reason: string | null,
) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/discount`, {
    expectedVersion: order.version,
    discount,
    reason,
  });

export const setServiceFee = (order: OrderDetailDto, waived: boolean, reason: string | null) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/service-fee`, {
    expectedVersion: order.version,
    waived,
    reason,
  });

/** Refuse a digital menu order (reason for the customer + internal note). */
export const rejectOrder = (
  order: OrderDetailDto,
  input: Omit<RejectOrderInput, 'expectedVersion'>,
) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/reject`, {
    expectedVersion: order.version,
    ...input,
  });

export const assignCourier = (order: OrderDetailDto, courierId: string | null) =>
  apiPost<OrderDetailDto>(`/orders/${order.id}/courier`, {
    expectedVersion: order.version,
    courierId,
  });

export const createTable = (input: TableInput) => apiPost<TableDto[]>('/tables', input);
export const updateTable = (id: string, input: TableInput) =>
  apiPatch<TableDto[]>(`/tables/${id}`, input);
export const createArea = (name: string) => apiPost<AreaDto>('/tables/areas', { name });
export const removeArea = (id: string) => api(`/tables/areas/${id}`, { method: 'DELETE' });

export const createCustomer = (input: CustomerInput) => apiPost<CustomerDto>('/customers', input);
export const createCourier = (input: { name: string; phone?: string }) =>
  apiPost<CourierDto>('/couriers', input);

export const createCoupon = (input: CouponInput) => apiPost<CouponDto>('/coupons', input);
export const updateCoupon = (id: string, input: CouponInput) =>
  apiPatch<CouponDto>(`/coupons/${id}`, input);

/** Kanban columns, in flow order. DISPATCHED only shows delivery orders. */
export const BOARD_COLUMNS: OrderStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DISPATCHED',
];

/** Theme token classes per status: they live with the badge in @app/ui. */
export { ORDER_STATUS_STYLES as STATUS_STYLES } from '@app/ui/components/status-badge';

/** Where the order goes: table + tab, customer, or "Balcão". */
export function orderTitle(
  o: Pick<OrderSummaryDto, 'type' | 'tableNames' | 'tabLabel' | 'customerName'>,
) {
  if (o.type === 'DINE_IN') {
    const table = o.tableNames.length ? `Mesa ${o.tableNames.join(' + ')}` : 'Mesa';
    return o.tabLabel ? `${table} · ${o.tabLabel}` : table;
  }
  return o.customerName ?? (o.type === 'TAKEOUT' ? 'Balcão' : 'Cliente');
}

export function matchesType(o: OrderSummaryDto, type: OrderType | 'ALL') {
  return type === 'ALL' || o.type === type;
}
