import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ErrorCode } from '@app/shared';
import { DomainError, ForbiddenError, UnauthorizedError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { extractBearer } from '../auth/jwt-auth.guard.js';
import {
  ALLOWS_PENDING_PASSWORD_KEY,
  IS_PLATFORM_PUBLIC_KEY,
  type PlatformRequest,
} from './platform.keys.js';

export const PLATFORM_ACCESS_AUDIENCE = 'platform';

export interface PlatformAccessPayload {
  sub: string;
  sid: string;
  aud: string;
}

/**
 * Authentication of the platform admin API: optional IP allowlist, then a platform access token
 * (own secret and audience; restaurant tokens never pass) bound to a live session.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const allowed = this.config.get('PLATFORM_ALLOWED_IPS');
    if (allowed.length && !allowed.includes(req.ip ?? '')) {
      throw new ForbiddenError('Acesso ao painel da plataforma não permitido desta rede');
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const token = extractBearer(req.headers.authorization);
    if (!token) throw new UnauthorizedError();
    let payload: PlatformAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformAccessPayload>(token, {
        secret: this.config.get('PLATFORM_JWT_SECRET'),
        audience: PLATFORM_ACCESS_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedError();
    }
    // Revoked sessions and disabled admins lose access right away.
    const session = await this.prisma.platformSession.findUnique({
      where: { id: payload.sid },
      include: { admin: true },
    });
    if (
      !session ||
      session.adminId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.admin.isActive ||
      !session.admin.totpEnabledAt
    ) {
      throw new UnauthorizedError();
    }
    // Temporary password: nothing but the password change until it is done.
    if (
      session.admin.passwordChangeRequired &&
      !this.reflector.getAllAndOverride<boolean>(ALLOWS_PENDING_PASSWORD_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new DomainError(
        'Troque a senha temporária para continuar',
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        403,
      );
    }
    req.admin = {
      id: session.admin.id,
      name: session.admin.name,
      email: session.admin.email,
      sessionId: session.id,
    };
    return true;
  }
}
