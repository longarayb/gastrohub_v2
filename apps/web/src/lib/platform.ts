import type { LegalDocument, PlatformModule, SignupStatusDto, StoreNoticesDto } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';

/** Platform notices of the current store (D042/D043): billing, support, terms and plan modules. */
export const platformKeys = {
  notices: ['platform', 'notices'] as const,
  terms: ['platform', 'terms'] as const,
  signup: ['platform', 'signup'] as const,
};

export const useStoreNotices = (enabled = true) =>
  useQuery({
    queryKey: platformKeys.notices,
    queryFn: () => apiGet<StoreNoticesDto>('/stores/current/notices'),
    enabled,
    // Read-only mode starts at the end of a business day: re-check now and then.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

export interface PlatformTermsDto {
  reviewNotice: string;
  terms: LegalDocument;
  privacy: LegalDocument;
}

export const usePlatformTerms = (enabled = true) =>
  useQuery({
    queryKey: platformKeys.terms,
    queryFn: () => apiGet<PlatformTermsDto>('/platform-terms'),
    enabled,
    staleTime: Infinity,
  });

export const useSignupStatus = () =>
  useQuery({
    queryKey: platformKeys.signup,
    queryFn: () => apiGet<SignupStatusDto>('/auth/signup-status'),
    staleTime: 60_000,
  });

export const acceptTerms = (versions: { termsVersion: string; privacyVersion: string }) =>
  apiPost('/stores/current/terms', versions);

/** Plan modules: null (no subscription) = everything available. */
export function moduleAvailable(
  modules: readonly PlatformModule[] | null | undefined,
  module: PlatformModule | undefined,
): boolean {
  return !module || !modules || modules.includes(module);
}

/** "2026-10-15" -> "15/10/2026" (calendar dates; never through Date, which would shift the day). */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
