import type {
  CollectionInput,
  CourierAppDto,
  CourierDetailDto,
  CourierLedgerEntryDto,
  CourierPayInput,
  CourierPaySettingsDto,
  CourierPayoutInput,
  CourierUpdateInput,
  DeliveryAreaDto,
  DeliveryAreaInput,
  DeliveryFailureInput,
  DeliveryQuoteDto,
  DeliveryQuoteInput,
  DeliveryReportDto,
  OrderDetailDto,
  OrderSummaryDto,
  PauseAreaInput,
  SettlementDto,
  SettlementInput,
  SettlementPreviewDto,
  UnmatchedNeighborhoodDto,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from './api';

/** Delivery queries; `delivery.updated` (realtime) invalidates everything under `all`. */
export const deliveryKeys = {
  all: ['delivery'] as const,
  areas: ['delivery', 'areas'] as const,
  unmatched: ['delivery', 'areas', 'unmatched'] as const,
  couriers: ['delivery', 'couriers'] as const,
  ledger: (id: string) => ['delivery', 'ledger', id] as const,
  settings: ['delivery', 'settings'] as const,
  preview: (courierId: string) => ['delivery', 'preview', courierId] as const,
  settlements: (courierId: string) => ['delivery', 'settlements', courierId] as const,
  report: (from: string, to: string) => ['delivery', 'report', from, to] as const,
  me: ['delivery', 'me'] as const,
};

export const useDeliveryAreas = (enabled = true) =>
  useQuery({
    queryKey: deliveryKeys.areas,
    queryFn: () => apiGet<DeliveryAreaDto[]>('/delivery/areas'),
    enabled,
  });

export const useUnmatchedNeighborhoods = (enabled = true) =>
  useQuery({
    queryKey: deliveryKeys.unmatched,
    queryFn: () => apiGet<UnmatchedNeighborhoodDto[]>('/delivery/areas/unmatched'),
    enabled,
  });

export const useCourierDetails = (enabled = true) =>
  useQuery({
    queryKey: deliveryKeys.couriers,
    queryFn: () => apiGet<CourierDetailDto[]>('/delivery/couriers'),
    enabled,
  });

export const useCourierLedger = (courierId: string | null) =>
  useQuery({
    queryKey: deliveryKeys.ledger(courierId ?? ''),
    queryFn: () => apiGet<CourierLedgerEntryDto[]>(`/delivery/couriers/${courierId}/ledger`),
    enabled: !!courierId,
  });

export const useCourierPaySettings = (enabled = true) =>
  useQuery({
    queryKey: deliveryKeys.settings,
    queryFn: () => apiGet<CourierPaySettingsDto>('/delivery/settings'),
    enabled,
  });

export const useSettlementPreview = (courierId: string | null) =>
  useQuery({
    queryKey: deliveryKeys.preview(courierId ?? ''),
    queryFn: () =>
      apiGet<SettlementPreviewDto>('/delivery/settlements/preview', { courierId: courierId! }),
    enabled: !!courierId,
  });

export const useSettlements = (courierId: string | null) =>
  useQuery({
    queryKey: deliveryKeys.settlements(courierId ?? ''),
    queryFn: () => apiGet<SettlementDto[]>('/delivery/settlements', { courierId: courierId! }),
    enabled: !!courierId,
  });

export const useDeliveryReport = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: deliveryKeys.report(from, to),
    queryFn: () => apiGet<DeliveryReportDto>('/delivery/report', { from, to }),
    enabled: enabled && !!from && !!to,
  });

/** Courier app: the signed-in courier's own open route. */
export const useCourierRoute = () =>
  useQuery({
    queryKey: deliveryKeys.me,
    queryFn: () => apiGet<CourierAppDto>('/courier/me'),
    // A fallback in case a realtime event is missed on a mobile connection.
    refetchInterval: 60_000,
  });

// ---- Mutations ----

export const quoteDelivery = (input: DeliveryQuoteInput) =>
  apiPost<DeliveryQuoteDto>('/delivery/quote', input);

export const createDeliveryArea = (input: DeliveryAreaInput) =>
  apiPost<DeliveryAreaDto>('/delivery/areas', input);
export const updateDeliveryArea = (id: string, input: DeliveryAreaInput) =>
  apiPut<DeliveryAreaDto>(`/delivery/areas/${id}`, input);
export const removeDeliveryArea = (id: string) => apiDelete(`/delivery/areas/${id}`);
export const pauseDeliveryArea = (id: string, input: PauseAreaInput) =>
  apiPost<DeliveryAreaDto>(`/delivery/areas/${id}/pause`, input);
export const resumeDeliveryArea = (id: string) =>
  apiPost<DeliveryAreaDto>(`/delivery/areas/${id}/resume`);
export const addAreaNeighborhood = (id: string, name: string) =>
  apiPost<DeliveryAreaDto>(`/delivery/areas/${id}/neighborhoods`, { name });

export const updateCourier = (id: string, input: CourierUpdateInput) =>
  apiPut<CourierDetailDto[]>(`/delivery/couriers/${id}`, input);
export const payCourier = (id: string, input: CourierPayoutInput) =>
  apiPost<CourierLedgerEntryDto[]>(`/delivery/couriers/${id}/payouts`, input);
export const updateCourierPaySettings = (input: CourierPayInput) =>
  apiPut<CourierPaySettingsDto>('/delivery/settings', input);
export const returnRun = (runId: string) => apiPost(`/delivery/runs/${runId}/return`);
export const settleCourier = (input: SettlementInput) =>
  apiPost<SettlementDto>('/delivery/settlements', input);

/** Several ready deliveries leave together with one courier. */
export const dispatchOrders = (
  courierId: string,
  orders: Pick<OrderSummaryDto, 'id' | 'version'>[],
) =>
  apiPost<OrderDetailDto[]>('/orders/dispatch', {
    courierId,
    orders: orders.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
  });

export const reportDeliveryFailure = (orderId: string, input: DeliveryFailureInput) =>
  apiPost<OrderDetailDto>(`/orders/${orderId}/delivery-failure`, input);

export const courierDeliver = (stopId: string, collection: CollectionInput | null) =>
  apiPost<CourierAppDto>(`/courier/stops/${stopId}/deliver`, { collection });
export const courierSetCollection = (stopId: string, collection: CollectionInput) =>
  apiPut<CourierAppDto>(`/courier/stops/${stopId}/collection`, collection);
export const courierFail = (stopId: string, input: DeliveryFailureInput) =>
  apiPost<CourierAppDto>(`/courier/stops/${stopId}/fail`, input);
export const courierReturn = () => apiPost<CourierAppDto>('/courier/return');

/** "1,2 km" / "800 m". */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return '';
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
    : `${meters} m`;
}

/** "25%" from basis points. */
export const formatBps = (bps: number) =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
