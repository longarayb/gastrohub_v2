import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AuthSession,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type Role,
  type SignupStatusDto,
  addDaysToDate,
  billingDate,
  onlyDigits,
  slugify,
} from '@app/shared';
import { AppConfig } from '../../core/config/app-config.service.js';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { MailService } from '../../core/mail/mail.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { type IssuedRefreshToken, TokenService, sha256 } from './token.service.js';

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

export interface SessionWithRefresh {
  session: AuthSession;
  refresh: IssuedRefreshToken;
}

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Invited users (platform admin, D041) have 7 days to set their first password. */
export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Password hash that never matches: invited users cannot sign in before accepting. */
export const UNUSABLE_PASSWORD = '!invite-pending';

/** Default opening hours for new stores: every day 11:00–23:00. */
export const DEFAULT_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  opensAt: '11:00',
  closesAt: '23:00',
}));

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    // Auth works across tenants (login, store selection), so it uses the raw client.
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  /** Public signup availability (D043): invite only by default; open with trial if configured. */
  async signupStatus(): Promise<SignupStatusDto> {
    const settings = await this.prisma.platformSettings.findUnique({ where: { id: 'default' } });
    return { mode: settings?.signupMode ?? 'INVITE_ONLY', trialDays: settings?.trialDays ?? 14 };
  }

  async register(input: RegisterInput & { cnpj: string; phone: string }, meta: RequestMeta) {
    const settings = await this.prisma.platformSettings.findUnique({ where: { id: 'default' } });
    const plan = settings?.signupPlanId
      ? await this.prisma.plan.findFirst({ where: { id: settings.signupPlanId, isActive: true } })
      : null;
    if (settings?.signupMode !== 'OPEN_TRIAL' || !plan) {
      throw new ForbiddenError(
        'O cadastro de novos restaurantes é feito por convite. Fale com a nossa equipe.',
      );
    }
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictError('Já existe uma conta com este e-mail');
    }
    const slug = await this.availableSlug(input.slug ?? input.tradeName);
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: input.tradeName,
          createdVia: 'SIGNUP',
          documentType: 'CNPJ',
          document: onlyDigits(input.cnpj),
          legalName: input.legalName,
          invoiceEmail: email,
          contactName: input.ownerName,
          contactEmail: email,
          contactPhone: input.phone,
        },
      });
      // Open signup starts the trial of the configured plan (D043).
      const today = billingDate(new Date());
      const trialEndsOn = addDaysToDate(today, settings.trialDays);
      const subscription = await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          priceCents: plan.priceCents,
          interval: plan.interval,
          trialEndsOn,
          billingStart: trialEndsOn,
        },
      });
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: subscription.id,
          kind: 'CREATED',
          toPlanId: plan.id,
          after: { trialEndsOn, priceCents: plan.priceCents, via: 'signup' },
        },
      });
      const store = await tx.store.create({
        data: {
          organizationId: org.id,
          slug,
          tradeName: input.tradeName,
          legalName: input.legalName,
          cnpj: input.cnpj,
          phone: input.phone,
          email,
          businessHours: { createMany: { data: DEFAULT_HOURS } },
        },
      });
      return tx.user.create({
        data: {
          name: input.ownerName,
          email,
          phone: input.phone,
          passwordHash,
          lastStoreId: store.id,
          memberships: { create: { tenantId: store.id, role: 'OWNER' } },
        },
      });
    });

    this.logger.log({ userId: user.id, slug }, 'Novo restaurante cadastrado');
    return this.startSession(user.id, undefined, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<SessionWithRefresh> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    const valid = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || !valid) throw new UnauthorizedError(INVALID_CREDENTIALS);
    if (!user.isActive) throw new ForbiddenError('Usuário desativado. Procure o responsável.');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.startSession(user.id, input.storeId, meta);
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<SessionWithRefresh> {
    if (!refreshToken) throw new UnauthorizedError();
    const { userId, refresh } = await this.tokens.rotateRefreshToken(refreshToken, meta);
    const session = await this.buildSession(userId);
    return { session, refresh };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeByToken(refreshToken);
  }

  /** Changes the active store. The refresh token stays valid; `lastStoreId` drives the next refresh. */
  async switchStore(userId: string, storeId: string): Promise<AuthSession> {
    return this.buildSession(userId, storeId);
  }

  async me(userId: string, tenantId: string): Promise<Omit<AuthSession, 'accessToken'>> {
    const { accessToken: _ignored, ...session } = await this.buildSession(userId, tenantId, false);
    return session;
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same response whether or not the e-mail exists (prevents account enumeration).
    if (!user || !user.isActive) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    const link = `${this.config.get('WEB_PUBLIC_URL')}/redefinir-senha?token=${token}`;
    await this.mail.sendPasswordReset(user.email, user.name, link);
  }

  /** Invitation e-mail with the link to set the first password (7 days). */
  async sendInvite(userId: string, storeName: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = randomBytes(32).toString('base64url');
    // A new invitation replaces the previous links.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, purpose: 'INVITE', usedAt: null },
      data: { expiresAt: new Date() },
    });
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        purpose: 'INVITE',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
      },
    });
    const link = `${this.config.get('WEB_PUBLIC_URL')}/convite?token=${token}`;
    await this.mail.sendInvite(user.email, user.name, storeName, link);
  }

  /** The invited user sets the first password and signs in. */
  async acceptInvite(input: ResetPasswordInput, meta: RequestMeta): Promise<SessionWithRefresh> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!stored || stored.purpose !== 'INVITE' || stored.usedAt || stored.expiresAt < new Date()) {
      throw new ValidationError('Convite inválido ou expirado. Peça um novo convite.');
    }
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return this.startSession(stored.userId, undefined, meta);
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!stored || stored.purpose !== 'RESET' || stored.usedAt || stored.expiresAt < new Date()) {
      throw new ValidationError('Link de redefinição inválido ou expirado. Solicite um novo.');
    }
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.tokens.revokeAllForUser(stored.userId);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('Usuário');
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new ValidationError('Senha atual incorreta');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
  }

  // ---------------------------------------------------------------------------

  private async startSession(
    userId: string,
    storeId: string | undefined,
    meta: RequestMeta,
  ): Promise<SessionWithRefresh> {
    const session = await this.buildSession(userId, storeId);
    const refresh = await this.tokens.issueRefreshToken(userId, meta);
    return { session, refresh };
  }

  /**
   * Resolves the active store (requested → last used → first available), persists it as
   * `lastStoreId` and signs a new access token for it.
   */
  private async buildSession(
    userId: string,
    requestedStoreId?: string,
    persist = true,
  ): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { isActive: true, store: { isActive: true, organization: { isActive: true } } },
          include: { store: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedError();
    if (user.memberships.length === 0) {
      throw new DomainError(
        'Seu usuário não está vinculado a nenhuma unidade ativa',
        'FORBIDDEN',
        403,
      );
    }

    let membership = requestedStoreId
      ? user.memberships.find((m) => m.tenantId === requestedStoreId)
      : (user.memberships.find((m) => m.tenantId === user.lastStoreId) ?? user.memberships[0]);
    if (!membership) {
      if (requestedStoreId) throw new ForbiddenError('Você não tem acesso a esta unidade');
      membership = user.memberships[0];
    }
    if (!membership) throw new UnauthorizedError();

    if (persist && user.lastStoreId !== membership.tenantId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastStoreId: membership.tenantId },
      });
    }

    const role = membership.role as Role;
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      tenantId: membership.tenantId,
      role,
    });

    return {
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      user: { id: user.id, name: user.name, email: user.email },
      store: {
        id: membership.store.id,
        slug: membership.store.slug,
        tradeName: membership.store.tradeName,
        logoUrl: membership.store.logoUrl,
      },
      role,
      memberships: user.memberships.map((m) => ({
        storeId: m.tenantId,
        tradeName: m.store.tradeName,
        role: m.role as Role,
      })),
    };
  }

  /** Finds a free slug based on `base`: "pizzaria-x", "pizzaria-x-2", ... */
  async availableSlug(base: string): Promise<string> {
    const root = slugify(base) || 'restaurante';
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      const exists = await this.prisma.store.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
    }
    return `${root}-${randomBytes(3).toString('hex')}`;
  }
}
