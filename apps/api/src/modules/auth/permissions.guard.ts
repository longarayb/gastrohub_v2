import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type AccessTokenPayload,
  KDS_DEVICE_ROLE,
  type Permission,
  hasPermission,
} from '@app/shared';
import { ForbiddenError } from '../../core/errors/domain-error.js';
import { PERMISSIONS_KEY } from './auth.decorators.js';

/** Global guard: enforces `@RequirePermissions(...)` using the role in the access token. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest<{ user?: AccessTokenPayload }>().user;
    // KDS devices only reach routes that explicitly require one of their permissions.
    if (user?.role === KDS_DEVICE_ROLE && !required?.length) throw new ForbiddenError();
    if (!required?.length) return true;

    if (!user || !required.every((p) => hasPermission(user.role, p))) {
      throw new ForbiddenError();
    }
    return true;
  }
}
