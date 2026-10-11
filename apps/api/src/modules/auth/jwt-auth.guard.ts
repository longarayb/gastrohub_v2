import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  type AccessTokenPayload,
  KDS_DEVICE_ROLE,
  PLATFORM_SUPPORT_ROLE,
  PRINT_AGENT_ROLE,
} from '@app/shared';
import type { Request } from 'express';
import { AppConfig } from '../../core/config/app-config.service.js';
import { UnauthorizedError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { IS_PLATFORM_KEY } from '../platform/platform.keys.js';
import { IS_PUBLIC_KEY } from './auth.decorators.js';

/**
 * Global guard: validates the Bearer access token and stores tenant/user/role
 * in the request context (used by the tenant-scoped Prisma client).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly ctx: TenantContext,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // Platform admin routes have their own guard and tokens (D041).
    const isPlatform = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPlatform) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new UnauthorizedError();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedError();
    }

    req.user = payload;
    if (payload.role === KDS_DEVICE_ROLE) {
      // A revoked tablet loses access right away, not only when its access token expires.
      const active = await this.prisma.kdsDevice.count({
        where: { id: payload.sub, tenantId: payload.tenantId, revokedAt: null },
      });
      if (!active) throw new UnauthorizedError('Esta tela foi desvinculada pelo gerente');
      this.ctx.set({ tenantId: payload.tenantId, deviceId: payload.sub, role: payload.role });
      return true;
    }
    if (payload.role === PRINT_AGENT_ROLE) {
      // Same for a print agent revoked in the panel.
      const active = await this.prisma.printAgent.count({
        where: { id: payload.sub, tenantId: payload.tenantId, revokedAt: null },
      });
      if (!active) throw new UnauthorizedError('Este computador foi desvinculado no painel');
      this.ctx.set({ tenantId: payload.tenantId, deviceId: payload.sub, role: payload.role });
      return true;
    }
    if (payload.role === PLATFORM_SUPPORT_ROLE) {
      // Support session (D041): valid only while open, for its own store, until its end time.
      const session = await this.prisma.supportSession.findUnique({ where: { id: payload.sub } });
      if (
        !session ||
        session.endedAt ||
        session.endsAt <= new Date() ||
        session.storeId !== payload.tenantId
      ) {
        throw new UnauthorizedError('O acesso de suporte terminou');
      }
      this.ctx.set({
        tenantId: payload.tenantId,
        userId: (payload as AccessTokenPayload & { uid?: string }).uid,
        role: payload.role,
        supportSessionId: session.id,
        supportMode: session.mode,
      });
      return true;
    }
    this.ctx.set({ tenantId: payload.tenantId, userId: payload.sub, role: payload.role });
    return true;
  }
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
