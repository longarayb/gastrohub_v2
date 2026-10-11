import type { Request } from 'express';

/**
 * Metadata keys and request types of the platform admin API (D041). Kept apart from the
 * decorators and guards so that both import them without a circular import (ESM TDZ).
 */
export const IS_PLATFORM_KEY = 'isPlatformRoute';
export const IS_PLATFORM_PUBLIC_KEY = 'isPlatformPublic';

export interface PlatformActor {
  adminId: string | null;
  /** E-mail typed in a failed login, when no admin is known. */
  email?: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface PlatformRequest extends Request {
  admin?: { id: string; name: string; email: string; sessionId: string };
}

export const actorOf = (req: PlatformRequest): PlatformActor => ({
  adminId: req.admin?.id ?? null,
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
});
