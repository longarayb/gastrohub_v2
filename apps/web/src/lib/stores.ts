import type { BusinessHour } from '@gastrohub/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export interface StoreDto {
  id: string;
  slug: string;
  tradeName: string;
  legalName: string;
  cnpj: string;
  phone: string;
  email: string | null;
  logoUrl: string | null;
  timezone: string;
  address: {
    cep: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    reference: string;
    latitude: number | null;
    longitude: number | null;
  };
  settings: {
    serviceFeeBps: number;
    kdsLateAfterMinutes: number;
    digitalMenuEnabled: boolean;
    deliveryMinimumCents: number;
    takeoutEtaMinutes: number;
    autoAcceptDigitalOrders: boolean;
  };
}

export const storeKeys = {
  current: ['store', 'current'] as const,
  hours: ['store', 'hours'] as const,
};

export function useCurrentStore() {
  return useQuery({
    queryKey: storeKeys.current,
    queryFn: () => apiGet<StoreDto>('/stores/current'),
  });
}

export function useBusinessHours() {
  return useQuery({
    queryKey: storeKeys.hours,
    queryFn: () => apiGet<BusinessHour[]>('/stores/current/hours'),
  });
}
