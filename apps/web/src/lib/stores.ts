import { type BusinessHour, currentBusinessDay } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
    digitalMenuEnabled: boolean;
    deliveryMinimumCents: number;
    takeoutEtaMinutes: number;
    autoAcceptDigitalOrders: boolean;
    pizzaPricingRule: 'HIGHEST' | 'AVERAGE';
    serviceFeeOrderTypes: ('DINE_IN' | 'TAKEOUT' | 'DELIVERY')[];
    blindCashClose: boolean;
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

/** Current business day of the store (night shifts belong to the day they started). */
export function useBusinessToday(): string | null {
  const { data: hours } = useBusinessHours();
  const { data: store } = useCurrentStore();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!hours || !store) return null;
  return currentBusinessDay(hours, now, store.timezone).date;
}
