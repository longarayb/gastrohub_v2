import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { AccessTokenPayload, Permission } from '@gastrohub/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as accessible without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Requires ALL listed permissions for the current role. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export type AuthUser = AccessTokenPayload;

/** Injects the authenticated user (JWT payload). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
