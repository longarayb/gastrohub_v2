import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload } from '@gastrohub/shared';
import { AppConfig } from '../../core/config/app-config.service.js';
import { UnauthorizedError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** "15m" | "1h" | "30s" | "900" -> seconds */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2] as '' | 's' | 'm' | 'h' | 'd'];
  return value * unit;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/**
 * Access tokens are short-lived JWTs. Refresh tokens are opaque random strings stored
 * hashed, rotated on every use; reusing a rotated token revokes its whole family.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  get accessTtlSeconds(): number {
    return ttlToSeconds(this.config.get('JWT_ACCESS_TTL'));
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds,
    });
  }

  async issueRefreshToken(
    userId: string,
    meta: { userAgent?: string; ip?: string },
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(token),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip,
      },
    });
    return { token, expiresAt };
  }

  /** Validates and rotates a refresh token. Returns the user id and the new token. */
  async rotateRefreshToken(
    token: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedError();
    }

    if (stored.replacedAt) {
      // Token reuse: someone used an already rotated token. Revoke the whole family.
      this.logger.warn({ userId: stored.userId, familyId: stored.familyId }, 'Refresh token reuse');
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedError();
    }

    // Atomic rotation: only one concurrent request can mark the token as replaced.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, replacedAt: null },
      data: { replacedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedError();

    const refresh = await this.issueRefreshToken(stored.userId, meta, stored.familyId);
    return { userId: stored.userId, refresh };
  }

  async revokeByToken(token: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
