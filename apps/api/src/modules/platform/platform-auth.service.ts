import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ErrorCode,
  type PlatformAdminDto,
  type PlatformEnrollment,
  type PlatformLoginStep,
  type PlatformSessionDto,
} from '@app/shared';
import argon2 from 'argon2';
import { AppConfig } from '../../core/config/app-config.service.js';
import { DomainError, UnauthorizedError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { PlatformAdmin } from '../../generated/prisma/client.js';
import { PasswordService } from '../auth/password.service.js';
import { sha256 } from '../auth/token.service.js';
import { PLATFORM_ACCESS_AUDIENCE } from './platform-auth.guard.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import type { PlatformActor } from './platform.keys.js';
import {
  RECOVERY_CODE_COUNT,
  decryptSecret,
  encryptSecret,
  newRecoveryCode,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  parseSecretsKey,
  verifyTotp,
} from './security/two-factor.js';

const CHALLENGE_AUDIENCE = 'platform-challenge';
const CHALLENGE_TTL = '5m';
export const PLATFORM_ACCESS_TTL_SECONDS = 10 * 60;
/** Absolute session length: the admin signs in again after it (with 2FA). */
export const PLATFORM_SESSION_HOURS = 12;
export const PLATFORM_MAX_FAILURES = 5;
export const PLATFORM_LOCK_MINUTES = 15;

interface ChallengePayload {
  sub: string;
  step: 'TOTP' | 'ENROLL';
}

export interface IssuedPlatformSession {
  session: PlatformSessionDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const LOGIN_FAILED = 'E-mail ou senha incorretos';
const CODE_FAILED = 'Código inválido. Confira o horário do celular e tente de novo.';

/**
 * Platform admin authentication (D041): password, then a mandatory second factor (TOTP or a
 * single-use recovery code). The first access enrolls the authenticator app before anything
 * else. Failures (password or code) lock the account for a while; everything is audited.
 */
@Injectable()
export class PlatformAuthService {
  private readonly secretsKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly audit: PlatformAuditService,
  ) {
    this.secretsKey = parseSecretsKey(config.get('PLATFORM_SECRETS_KEY'));
  }

  // ---- Step 1: password ----

  async login(email: string, password: string, actor: PlatformActor): Promise<PlatformLoginStep> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      await this.passwords.verify(undefined, password);
      await this.audit.log(
        { action: PlatformAuditAction.LOGIN_PASSWORD_FAILED, entity: 'PlatformAdmin' },
        { ...actor, email },
      );
      throw new UnauthorizedError(LOGIN_FAILED);
    }
    this.assertNotLocked(admin);
    if (!(await this.passwords.verify(admin.passwordHash, password))) {
      await this.registerFailure(admin, PlatformAuditAction.LOGIN_PASSWORD_FAILED, actor);
      throw new UnauthorizedError(LOGIN_FAILED);
    }
    const step = admin.totpEnabledAt ? 'TOTP' : 'ENROLL';
    const challenge = await this.jwt.signAsync({ sub: admin.id, step } satisfies ChallengePayload, {
      secret: this.config.get('PLATFORM_JWT_SECRET'),
      audience: CHALLENGE_AUDIENCE,
      expiresIn: CHALLENGE_TTL,
    });
    return { step, challenge };
  }

  // ---- Step 2: second factor ----

  async verifyCode(
    challenge: string,
    code: string,
    actor: PlatformActor,
  ): Promise<IssuedPlatformSession> {
    const admin = await this.fromChallenge(challenge, 'TOTP');
    this.assertNotLocked(admin);
    const secret = decryptSecret(admin.totpSecretEnc!, this.secretsKey);
    const counter = verifyTotp(secret, code, new Date(), admin.totpLastCounter);
    if (counter == null) {
      await this.registerFailure(admin, PlatformAuditAction.LOGIN_TOTP_FAILED, actor);
      throw new UnauthorizedError(CODE_FAILED);
    }
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpLastCounter: counter },
    });
    return this.startSession(admin, actor);
  }

  async recover(
    challenge: string,
    input: string,
    actor: PlatformActor,
  ): Promise<IssuedPlatformSession> {
    const admin = await this.fromChallenge(challenge, 'TOTP');
    this.assertNotLocked(admin);
    const code = normalizeRecoveryCode(input);
    const codes = await this.prisma.platformRecoveryCode.findMany({
      where: { adminId: admin.id, usedAt: null },
    });
    let matched: string | null = null;
    for (const c of codes) {
      if (await argon2.verify(c.codeHash, code).catch(() => false)) {
        matched = c.id;
        break;
      }
    }
    if (!matched) {
      await this.registerFailure(admin, PlatformAuditAction.LOGIN_TOTP_FAILED, actor);
      throw new UnauthorizedError('Código de recuperação inválido ou já usado');
    }
    // Conditional update: the same code never works twice, even in parallel.
    const used = await this.prisma.platformRecoveryCode.updateMany({
      where: { id: matched, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (!used.count) throw new UnauthorizedError('Código de recuperação inválido ou já usado');
    await this.audit.log(
      {
        action: PlatformAuditAction.LOGIN_RECOVERY_CODE,
        entity: 'PlatformAdmin',
        entityId: admin.id,
        after: { left: codes.length - 1 },
      },
      { ...actor, adminId: admin.id },
    );
    return this.startSession(admin, actor);
  }

  // ---- First access: enroll the authenticator app ----

  async enrollStart(challenge: string): Promise<PlatformEnrollment> {
    const admin = await this.fromChallenge(challenge, 'ENROLL');
    const secret = newTotpSecret();
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpPendingSecretEnc: encryptSecret(secret, this.secretsKey) },
    });
    return { secret, otpauthUrl: otpauthUrl(this.config.get('APP_NAME'), admin.email, secret) };
  }

  async enrollConfirm(
    challenge: string,
    code: string,
    actor: PlatformActor,
  ): Promise<IssuedPlatformSession> {
    const admin = await this.fromChallenge(challenge, 'ENROLL');
    this.assertNotLocked(admin);
    if (!admin.totpPendingSecretEnc) {
      throw new ValidationError('Gere o QR Code antes de confirmar o código');
    }
    const secret = decryptSecret(admin.totpPendingSecretEnc, this.secretsKey);
    const counter = verifyTotp(secret, code);
    if (counter == null) {
      await this.registerFailure(admin, PlatformAuditAction.LOGIN_TOTP_FAILED, actor);
      throw new UnauthorizedError(CODE_FAILED);
    }
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({
        where: { id: admin.id },
        data: {
          totpSecretEnc: admin.totpPendingSecretEnc,
          totpPendingSecretEnc: null,
          totpEnabledAt: new Date(),
          totpLastCounter: counter,
        },
      });
      const codes = await this.replaceRecoveryCodes(admin.id, tx);
      await this.audit.log(
        { action: PlatformAuditAction.TOTP_ENROLLED, entity: 'PlatformAdmin', entityId: admin.id },
        { ...actor, adminId: admin.id },
        tx,
      );
      return codes;
    });
    const issued = await this.startSession({ ...admin, totpEnabledAt: new Date() }, actor);
    issued.session.recoveryCodes = recoveryCodes;
    return issued;
  }

  /** New set of recovery codes (the old ones stop working); requires a current code. */
  async regenerateRecoveryCodes(
    adminId: string,
    code: string,
    actor: PlatformActor,
  ): Promise<string[]> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    const secret = decryptSecret(admin.totpSecretEnc!, this.secretsKey);
    const counter = verifyTotp(secret, code, new Date(), admin.totpLastCounter);
    if (counter == null) throw new ValidationError(CODE_FAILED);
    return this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({ where: { id: adminId }, data: { totpLastCounter: counter } });
      const codes = await this.replaceRecoveryCodes(adminId, tx);
      await this.audit.log(
        {
          action: PlatformAuditAction.RECOVERY_CODES_REGENERATED,
          entity: 'PlatformAdmin',
          entityId: adminId,
        },
        actor,
        tx,
      );
      return codes;
    });
  }

  // ---- Sessions ----

  async refresh(token: string | undefined): Promise<IssuedPlatformSession> {
    if (!token) throw new UnauthorizedError();
    const session = await this.prisma.platformSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { admin: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.admin.isActive ||
      !session.admin.totpEnabledAt
    ) {
      throw new UnauthorizedError();
    }
    const next = randomBytes(32).toString('base64url');
    await this.prisma.platformSession.update({
      where: { id: session.id },
      data: { tokenHash: sha256(next), lastUsedAt: new Date() },
    });
    return {
      session: await this.sessionDto(session.admin, session.id),
      refreshToken: next,
      refreshExpiresAt: session.expiresAt,
    };
  }

  async logout(token: string | undefined, actor: PlatformActor): Promise<void> {
    if (!token) return;
    const session = await this.prisma.platformSession.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!session || session.revokedAt) return;
    await this.prisma.platformSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.log(
      { action: PlatformAuditAction.LOGOUT, entity: 'PlatformAdmin', entityId: session.adminId },
      { ...actor, adminId: session.adminId },
    );
  }

  async me(adminId: string): Promise<PlatformAdminDto> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    return this.adminDto(admin);
  }

  // ---- Server-side commands (scripts, never the HTTP API) ----

  /** Creates an admin (seed and the `platform:create-admin` command). */
  async createAdmin(
    input: { email: string; name: string; password: string; totpSecret?: string },
    actor: PlatformActor,
  ): Promise<PlatformAdmin> {
    const admin = await this.prisma.platformAdmin.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await this.passwords.hash(input.password),
        // Seed only: a known secret so the demo and the walkthroughs can sign in.
        ...(input.totpSecret
          ? {
              totpSecretEnc: encryptSecret(input.totpSecret, this.secretsKey),
              totpEnabledAt: new Date(),
            }
          : {}),
      },
    });
    await this.audit.log(
      {
        action: PlatformAuditAction.ADMIN_CREATED,
        entity: 'PlatformAdmin',
        entityId: admin.id,
        after: { email: admin.email, name: admin.name },
      },
      actor,
    );
    return admin;
  }

  /**
   * Emergency reset of an admin's second factor (`platform:reset-2fa`, run on the server): the
   * authenticator, recovery codes and sessions are erased; the next login enrolls again.
   */
  async resetTwoFactor(email: string, reason: string, actor: PlatformActor): Promise<void> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin) throw new ValidationError(`Administrador não encontrado: ${email}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({
        where: { id: admin.id },
        data: {
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastCounter: null,
          failedLogins: 0,
          lockedUntil: null,
        },
      });
      await tx.platformRecoveryCode.deleteMany({ where: { adminId: admin.id } });
      await tx.platformSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          action: PlatformAuditAction.TOTP_RESET_EMERGENCY,
          entity: 'PlatformAdmin',
          entityId: admin.id,
          reason,
          after: { email: admin.email },
        },
        actor,
        tx,
      );
    });
  }

  // ---- Internals ----

  private async fromChallenge(
    challenge: string,
    step: ChallengePayload['step'],
  ): Promise<PlatformAdmin> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(challenge, {
        secret: this.config.get('PLATFORM_JWT_SECRET'),
        audience: CHALLENGE_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedError('O login expirou. Digite a senha de novo.');
    }
    if (payload.step !== step) throw new UnauthorizedError('Etapa de login inválida');
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new UnauthorizedError();
    if (step === 'TOTP' && !admin.totpEnabledAt)
      throw new UnauthorizedError('Etapa de login inválida');
    if (step === 'ENROLL' && admin.totpEnabledAt) {
      throw new UnauthorizedError('A verificação em duas etapas já está ativa');
    }
    return admin;
  }

  private assertNotLocked(admin: PlatformAdmin): void {
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new DomainError(
        `Acesso bloqueado por tentativas erradas. Tente de novo em ${minutes} min.`,
        ErrorCode.RATE_LIMITED,
        429,
      );
    }
  }

  private async registerFailure(
    admin: PlatformAdmin,
    action: PlatformAuditAction,
    actor: PlatformActor,
  ): Promise<void> {
    const failures = admin.failedLogins + 1;
    const lock = failures >= PLATFORM_MAX_FAILURES;
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        failedLogins: lock ? 0 : failures,
        lockedUntil: lock
          ? new Date(Date.now() + PLATFORM_LOCK_MINUTES * 60_000)
          : admin.lockedUntil,
      },
    });
    await this.audit.log(
      { action, entity: 'PlatformAdmin', entityId: admin.id },
      { ...actor, adminId: admin.id },
    );
    if (lock) {
      await this.audit.log(
        {
          action: PlatformAuditAction.LOGIN_LOCKED,
          entity: 'PlatformAdmin',
          entityId: admin.id,
          after: { minutes: PLATFORM_LOCK_MINUTES },
        },
        { ...actor, adminId: admin.id },
      );
    }
  }

  private async replaceRecoveryCodes(
    adminId: string,
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx.platformRecoveryCode.deleteMany({ where: { adminId } });
    for (const code of codes) {
      await tx.platformRecoveryCode.create({
        data: { adminId, codeHash: await argon2.hash(code, { type: argon2.argon2id }) },
      });
    }
    return codes;
  }

  private async startSession(
    admin: PlatformAdmin,
    actor: PlatformActor,
  ): Promise<IssuedPlatformSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PLATFORM_SESSION_HOURS * 3_600_000);
    const session = await this.prisma.platformSession.create({
      data: {
        adminId: admin.id,
        tokenHash: sha256(refreshToken),
        expiresAt,
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
    });
    const updated = await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log(
      { action: PlatformAuditAction.LOGIN_SUCCEEDED, entity: 'PlatformAdmin', entityId: admin.id },
      { ...actor, adminId: admin.id },
    );
    return {
      session: await this.sessionDto(updated, session.id),
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  private async sessionDto(admin: PlatformAdmin, sessionId: string): Promise<PlatformSessionDto> {
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, sid: sessionId },
      {
        secret: this.config.get('PLATFORM_JWT_SECRET'),
        audience: PLATFORM_ACCESS_AUDIENCE,
        expiresIn: PLATFORM_ACCESS_TTL_SECONDS,
      },
    );
    return {
      accessToken,
      expiresIn: PLATFORM_ACCESS_TTL_SECONDS,
      admin: await this.adminDto(admin),
    };
  }

  private async adminDto(admin: PlatformAdmin): Promise<PlatformAdminDto> {
    const recoveryCodesLeft = await this.prisma.platformRecoveryCode.count({
      where: { adminId: admin.id, usedAt: null },
    });
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      totpEnabled: !!admin.totpEnabledAt,
      recoveryCodesLeft,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    };
  }
}
