import type {
  BlockedPhoneDto,
  BlockedPhoneInput,
  DigitalMenuSettingsDto,
  DigitalMenuSettingsInput,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { api, apiDelete, apiGet, apiPost, apiPut } from './api';

export const digitalMenuKeys = {
  settings: ['digital-menu', 'settings'] as const,
  blocked: ['digital-menu', 'blocked'] as const,
};

export const useDigitalMenuSettings = () =>
  useQuery({
    queryKey: digitalMenuKeys.settings,
    queryFn: () => apiGet<DigitalMenuSettingsDto>('/digital-menu/settings'),
  });

export const useBlockedPhones = () =>
  useQuery({
    queryKey: digitalMenuKeys.blocked,
    queryFn: () => apiGet<BlockedPhoneDto[]>('/digital-menu/blocked-phones'),
  });

export const updateDigitalMenuSettings = (input: DigitalMenuSettingsInput) =>
  apiPut<DigitalMenuSettingsDto>('/digital-menu/settings', input);

export function uploadMenuCover(file: File) {
  const body = new FormData();
  body.append('file', file);
  return api<DigitalMenuSettingsDto>('/digital-menu/cover', { method: 'POST', body });
}

export const removeMenuCover = () => apiDelete<DigitalMenuSettingsDto>('/digital-menu/cover');

export const blockPhone = (input: BlockedPhoneInput) =>
  apiPost<BlockedPhoneDto[]>('/digital-menu/blocked-phones', input);

export const unblockPhone = (id: string) =>
  apiDelete<BlockedPhoneDto[]>(`/digital-menu/blocked-phones/${id}`);
