import {
  type ExecutionContext,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import {
  ALLOWS_PENDING_PASSWORD_KEY,
  IS_PLATFORM_KEY,
  IS_PLATFORM_PUBLIC_KEY,
  type PlatformRequest,
  actorOf,
} from './platform.keys.js';

/**
 * Platform admin routes (D041) live under /api/platform and use their own authentication:
 * the restaurant guards (JwtAuthGuard, PermissionsGuard) skip them, and PlatformAuthGuard
 * accepts only platform admin tokens.
 */
export const PlatformController = () =>
  applyDecorators(SetMetadata(IS_PLATFORM_KEY, true), UseGuards(PlatformAuthGuard));

/** Admin login steps: no admin token yet (still subject to the IP allowlist). */
export const PlatformPublic = () => SetMetadata(IS_PLATFORM_PUBLIC_KEY, true);

/**
 * Routes an admin with a temporary password may still use (who am I, change the password).
 * Every other route answers 403 PASSWORD_CHANGE_REQUIRED until the password is changed.
 */
export const AllowsPendingPassword = () => SetMetadata(ALLOWS_PENDING_PASSWORD_KEY, true);

/** The signed-in platform admin and request metadata, for the audit trail. */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  actorOf(ctx.switchToHttp().getRequest<PlatformRequest>()),
);
