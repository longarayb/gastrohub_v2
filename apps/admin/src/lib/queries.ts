import type {
  CustomerDetailDto,
  CustomerListItemDto,
  PlanDto,
  PlatformAuditEntryDto,
  PlatformInvoiceDto,
  PlatformOverviewDto,
  PlatformSettingsDto,
  SupportSessionDto,
} from '@app/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from './api';

export const keys = {
  all: ['platform'] as const,
  overview: ['platform', 'overview'] as const,
  customers: (q: string) => ['platform', 'customers', q] as const,
  customer: (id: string) => ['platform', 'customer', id] as const,
  plans: ['platform', 'plans'] as const,
  invoices: (status: string) => ['platform', 'invoices', status] as const,
  settings: ['platform', 'settings'] as const,
  support: ['platform', 'support'] as const,
  audit: (action: string) => ['platform', 'audit', action] as const,
};

export const useOverview = () =>
  useQuery({ queryKey: keys.overview, queryFn: () => apiGet<PlatformOverviewDto>('/overview') });

export const useCustomers = (q: string) =>
  useQuery({
    queryKey: keys.customers(q),
    queryFn: () => apiGet<CustomerListItemDto[]>('/customers', { q }),
    placeholderData: (previous) => previous,
  });

export const useCustomer = (id: string) =>
  useQuery({
    queryKey: keys.customer(id),
    queryFn: () => apiGet<CustomerDetailDto>(`/customers/${id}`),
  });

export const usePlans = () =>
  useQuery({ queryKey: keys.plans, queryFn: () => apiGet<PlanDto[]>('/plans') });

export const useInvoices = (status: string) =>
  useQuery({
    queryKey: keys.invoices(status),
    queryFn: () => apiGet<PlatformInvoiceDto[]>('/invoices', { status }),
  });

export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => apiGet<PlatformSettingsDto>('/settings') });

export const useSupportSessions = () =>
  useQuery({
    queryKey: keys.support,
    queryFn: () => apiGet<SupportSessionDto[]>('/support-sessions'),
    refetchInterval: 30_000,
  });

export const useAudit = (action: string, before: string | null) =>
  useQuery({
    queryKey: [...keys.audit(action), before],
    queryFn: () =>
      apiGet<{ items: PlatformAuditEntryDto[]; next: string | null }>('/audit', {
        action,
        before,
      }),
    placeholderData: (previous) => previous,
  });

/** Everything changes together after an admin action (lists, details, overview). */
export function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.all });
}

/** "2026-10-15" -> "15/10/2026" (calendar dates; never through Date). */
export function formatCalendarDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
