/**
 * Platform rules without validation code (light for the browser bundles): plan modules,
 * signup mode, terms versions and support sessions.
 */

/** Modules a plan may include. Absent from the plan = hidden in the panel and refused by the API. */
export const PlatformModule = {
  DIGITAL_MENU: 'DIGITAL_MENU',
  DELIVERY: 'DELIVERY',
  KDS: 'KDS',
  PRINTING: 'PRINTING',
  /** Future marketplace integrations (iFood, Open Delivery). */
  MARKETPLACES: 'MARKETPLACES',
} as const;
export type PlatformModule = (typeof PlatformModule)[keyof typeof PlatformModule];
export const PLATFORM_MODULES = Object.values(PlatformModule);

export const PLATFORM_MODULE_LABELS: Record<PlatformModule, string> = {
  DIGITAL_MENU: 'Cardápio digital',
  DELIVERY: 'Delivery (áreas, saídas e app do entregador)',
  KDS: 'Telas da cozinha (KDS)',
  PRINTING: 'Impressão automática',
  MARKETPLACES: 'Integrações com marketplaces (em breve)',
};

/** Whether `module` is part of the organization's plan. */
export const hasModule = (modules: readonly string[], module: PlatformModule): boolean =>
  modules.includes(module);

export const SignupMode = { INVITE_ONLY: 'INVITE_ONLY', OPEN_TRIAL: 'OPEN_TRIAL' } as const;
export type SignupMode = (typeof SignupMode)[keyof typeof SignupMode];
export const SIGNUP_MODE_LABELS: Record<SignupMode, string> = {
  INVITE_ONLY: 'Só por convite',
  OPEN_TRIAL: 'Aberto, com período de teste',
};

// ---------------------------------------------------------------------------
// Terms of use and privacy policy of the platform (accepted by each organization owner)

/** Bump when the text changes: owners are asked to accept again on their next access. */
export const PLATFORM_TERMS_VERSION = '2026-10-11';
export const PLATFORM_PRIVACY_VERSION = '2026-10-11';

export interface TermsAcceptance {
  termsVersion: string;
  privacyVersion: string;
}

/** Whether the owner must (re)accept: never accepted, or any of the two texts changed. */
export function needsTermsAcceptance(
  latest: TermsAcceptance | null,
  current: TermsAcceptance = {
    termsVersion: PLATFORM_TERMS_VERSION,
    privacyVersion: PLATFORM_PRIVACY_VERSION,
  },
): boolean {
  return (
    !latest ||
    latest.termsVersion !== current.termsVersion ||
    latest.privacyVersion !== current.privacyVersion
  );
}

// ---------------------------------------------------------------------------
// Platform admins created on the server

/** A temporary password (command `create` or `reset-password`) works for this long, unused. */
export const PLATFORM_TEMP_PASSWORD_HOURS = 24;

// ---------------------------------------------------------------------------
// Support sessions (platform admin inside a customer's panel)

export const SUPPORT_SESSION_MINUTES = { min: 15, max: 60, default: 30 } as const;

export const SupportAccessMode = { READ_ONLY: 'READ_ONLY', READ_WRITE: 'READ_WRITE' } as const;
export type SupportAccessMode = (typeof SupportAccessMode)[keyof typeof SupportAccessMode];
export const SUPPORT_ACCESS_MODE_LABELS: Record<SupportAccessMode, string> = {
  READ_ONLY: 'Somente leitura',
  READ_WRITE: 'Com alterações',
};

/** Ends at the requested duration, clamped to the allowed range. */
export function supportSessionEndsAt(startedAt: Date, minutes: number): Date {
  const clamped = Math.min(
    SUPPORT_SESSION_MINUTES.max,
    Math.max(SUPPORT_SESSION_MINUTES.min, Math.round(minutes)),
  );
  return new Date(startedAt.getTime() + clamped * 60_000);
}

/** HTTP methods a read-only support session may use (plus ending the session itself). */
export const isReadOnlyMethod = (method: string): boolean =>
  ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
