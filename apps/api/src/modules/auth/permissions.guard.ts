import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AccessTokenPayload, type Permission, hasPermission } from '@app/shared';
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
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AccessTokenPayload }>().user;
    if (!user || !required.every((p) => hasPermission(user.role, p))) {
      throw new ForbiddenError();
    }
    return true;
  }
}
