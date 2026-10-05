import type {
  KdsBoardDto,
  KdsDeviceDto,
  KdsDeviceInput,
  KdsDeviceSessionDto,
  KdsExpeditionDto,
  KdsPairingCodeDto,
  KdsProductDto,
  KdsSectorDto,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { API_URL, ApiError, apiGet, apiPatch, apiPost } from './api';

export const kdsKeys = {
  all: ['kds'] as const,
  sectors: ['kds', 'sectors'] as const,
  board: (sectorIds: string[]) => ['kds', 'board', [...sectorIds].sort().join(',')] as const,
  expedition: ['kds', 'expedition'] as const,
  products: (sectorIds: string[]) => ['kds', 'products', [...sectorIds].sort().join(',')] as const,
  devices: ['kds', 'devices'] as const,
};

/** Safety net if a realtime event is missed (events trigger refetches right away). */
const POLL_MS = 30_000;
/** Screens stay open all day: old board variants leave the cache quickly. */
const GC_MS = 60_000;

export const useKdsSectors = (enabled = true) =>
  useQuery({
    queryKey: kdsKeys.sectors,
    queryFn: () => apiGet<KdsSectorDto[]>('/kds/sectors'),
    enabled,
  });

export const useKdsBoard = (sectorIds: string[], enabled = true) =>
  useQuery({
    queryKey: kdsKeys.board(sectorIds),
    queryFn: () => apiGet<KdsBoardDto>('/kds/board', { sectors: sectorIds.join(',') }),
    enabled: enabled && sectorIds.length > 0,
    refetchInterval: POLL_MS,
    gcTime: GC_MS,
  });

export const useKdsExpedition = (enabled = true) =>
  useQuery({
    queryKey: kdsKeys.expedition,
    queryFn: () => apiGet<KdsExpeditionDto>('/kds/expedition'),
    enabled,
    refetchInterval: POLL_MS,
    gcTime: GC_MS,
  });

export const useKdsProducts = (sectorIds: string[], enabled = true) =>
  useQuery({
    queryKey: kdsKeys.products(sectorIds),
    queryFn: () => apiGet<KdsProductDto[]>('/kds/products', { sectors: sectorIds.join(',') }),
    enabled: enabled && sectorIds.length > 0,
    gcTime: GC_MS,
  });

export const startTasks = (taskIds: string[]) => apiPost('/kds/tasks/start', { taskIds });
export const readyTasks = (taskIds: string[]) => apiPost('/kds/tasks/ready', { taskIds });
export const recallTask = (taskId: string) => apiPost(`/kds/tasks/${taskId}/recall`);
export const serveRounds = (orderId: string, roundIds: string[]) =>
  apiPost(`/kds/orders/${orderId}/serve`, { roundIds });
export const dispatchOrder = (orderId: string, expectedVersion: number, courierId: string) =>
  apiPost(`/kds/orders/${orderId}/dispatch`, { expectedVersion, courierId });
export const pauseProduct = (productId: string) =>
  apiPost(`/menu/products/${productId}/pause`, { mode: 'END_OF_DAY' });
export const resumeProduct = (productId: string) => apiPost(`/menu/products/${productId}/resume`);

// ---- Devices (manager) ----

export const useKdsDevices = (enabled = true) =>
  useQuery({
    queryKey: kdsKeys.devices,
    queryFn: () => apiGet<KdsDeviceDto[]>('/kds/devices'),
    enabled,
  });

export const createKdsDevice = (input: KdsDeviceInput) =>
  apiPost<KdsPairingCodeDto>('/kds/devices', input);
export const updateKdsDevice = (id: string, input: KdsDeviceInput) =>
  apiPatch<KdsDeviceDto>(`/kds/devices/${id}`, input);
export const newPairingCode = (id: string) =>
  apiPost<KdsPairingCodeDto>(`/kds/devices/${id}/pairing-code`);
export const revokeKdsDevice = (id: string) => apiPost<KdsDeviceDto>(`/kds/devices/${id}/revoke`);

// ---- Device session (tablet; the credential lives in an httpOnly cookie) ----

async function deviceCall(path: string, body?: unknown): Promise<KdsDeviceSessionDto> {
  const res = await fetch(`${API_URL}/api/kds-device/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as KdsDeviceSessionDto;
}

export const pairDevice = (store: string, code: string) => deviceCall('pair', { store, code });
export const renewDeviceSession = () => deviceCall('session');
export async function unpairDevice(): Promise<void> {
  await fetch(`${API_URL}/api/kds-device/unpair`, { method: 'POST', credentials: 'include' });
}
