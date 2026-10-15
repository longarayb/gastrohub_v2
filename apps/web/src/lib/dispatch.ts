import type {
  DispatchBoardDto,
  OrderDetailDto,
  OrderLocationInput,
  OrderLocationResultDto,
  RouteSuggestionDto,
  RouteSuggestionInput,
  SimulationInput,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from './api';

/** Under `delivery`: `delivery.updated` and order events refresh the dispatch board. */
export const dispatchKeys = {
  board: ['delivery', 'dispatch'] as const,
};

export const useDispatchBoard = () =>
  useQuery({
    queryKey: dispatchKeys.board,
    queryFn: () => apiGet<DispatchBoardDto>('/dispatch/board'),
  });

export const suggestRoute = (input: RouteSuggestionInput) =>
  apiPost<RouteSuggestionDto>('/dispatch/routes/suggest', input);

/** The orders leave in this order (the stops keep it). */
export const dispatchRun = (
  courierId: string,
  orders: readonly { id: string; version: number }[],
) =>
  apiPost<OrderDetailDto[]>('/dispatch/runs', {
    courierId,
    orders: orders.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
  });

export const setOrderLocation = (orderId: string, input: OrderLocationInput) =>
  apiPatch<OrderLocationResultDto>(`/dispatch/orders/${orderId}/location`, input);

export const startSimulation = (runId: string, input: SimulationInput) =>
  apiPost<void>(`/dispatch/runs/${runId}/simulate`, input);

export const stopSimulation = (runId: string) => apiDelete(`/dispatch/runs/${runId}/simulate`);
