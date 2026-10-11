import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type AuthSession,
  PLATFORM_SUPPORT_ROLE,
  SUPPORT_ACCESS_MODE_LABELS,
  type SupportSessionDto,
  formatDateTime,
  supportSessionEndsAt,
} from '@app/shared';
import { AppConfig } from '../../core/config/app-config.service.js';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { MailService } from '../../core/mail/mail.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { SupportSession } from '../../generated/prisma/client.js';
import { UNUSABLE_PASSWORD } from '../auth/auth.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import { PlatformDirectoryService, toSupportDto } from './platform-directory.service.js';
import type { PlatformActor } from './platform.keys.js';

/** Global user that signs the support actions in the stores' audit (never signs in). */
export const SUPPORT_USER_EMAIL = 'suporte@plataforma.invalid';
export const SUPPORT_USER_NAME = 'Suporte da plataforma';

/**
 * Platform support inside a customer's store (D041): with a reason, for a limited time
 * (15–60 min), read-only unless opened "with changes"; a banner for everyone in the store,
 * an e-mail to the owners and both audits (store and platform) record the session.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly ctx: TenantContext,
    private readonly storeAudit: AuditService,
    private readonly audit: PlatformAuditService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeService,
    private readonly directory: PlatformDirectoryService,
  ) {}

  async list(): Promise<SupportSessionDto[]> {
    const sessions = await this.prisma.supportSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return this.dtos(sessions);
  }

  async start(
    input: { storeId: string; reason: string; minutes: number; mode: 'READ_ONLY' | 'READ_WRITE' },
    actor: PlatformActor,
  ): Promise<{ session: SupportSessionDto; url: string }> {
    const store = await this.prisma.store.findUnique({
      where: { id: input.storeId },
      include: { organization: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    if (!store.isActive || !store.organization.isActive) {
      throw new ValidationError('Unidade ou cliente desativado');
    }
    const supportUser = await this.supportUser();
    const startedAt = new Date();
    const endsAt = supportSessionEndsAt(startedAt, input.minutes);

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportSession.create({
        data: {
          adminId: actor.adminId!,
          organizationId: store.organizationId,
          storeId: store.id,
          reason: input.reason,
          mode: input.mode,
          startedAt,
          endsAt,
          ip: actor.ip,
        },
      });
      await this.audit.log(
        {
          action: PlatformAuditAction.SUPPORT_STARTED,
          entity: 'SupportSession',
          entityId: created.id,
          organizationId: store.organizationId,
          storeId: store.id,
          reason: input.reason,
          after: { mode: input.mode, endsAt },
        },
        actor,
        tx,
      );
      return created;
    });

    // The store's own audit shows the session too (the owner sees it in the panel).
    await this.inStore(store.id, supportUser, session.id, () =>
      this.storeAudit.log({
        action: AuditAction.SUPPORT_STARTED,
        entity: 'SupportSession',
        entityId: session.id,
        reason: input.reason,
        after: { mode: input.mode, endsAt },
      }),
    );

    const owners = await this.prisma.membership.findMany({
      where: { tenantId: store.id, role: 'OWNER', isActive: true },
      include: { user: true },
    });
    for (const o of owners) {
      if (o.user.passwordHash === UNUSABLE_PASSWORD) continue;
      await this.mail.sendSupportStarted(o.user.email, o.user.name, {
        storeName: store.tradeName,
        reason: input.reason,
        mode: SUPPORT_ACCESS_MODE_LABELS[input.mode],
        endsAt: formatDateTime(endsAt),
      });
    }
    this.realtime.noticesUpdated(store.id);

    const token = await this.jwt.signAsync(
      { sub: session.id, tenantId: store.id, role: PLATFORM_SUPPORT_ROLE, uid: supportUser },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: Math.max(1, Math.floor((endsAt.getTime() - Date.now()) / 1000)),
      },
    );
    const url = `${this.config.get('WEB_PUBLIC_URL')}/suporte#token=${encodeURIComponent(token)}`;
    const [dto] = await this.dtos([session]);
    return { session: dto!, url };
  }

  async end(id: string, actor: PlatformActor): Promise<SupportSessionDto> {
    const session = await this.prisma.supportSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundError('Sessão de suporte');
    if (session.endedAt || session.endsAt <= new Date()) {
      const [dto] = await this.dtos([session]);
      return dto!;
    }
    const ended = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportSession.update({
        where: { id },
        data: { endedAt: new Date() },
      });
      await this.audit.log(
        {
          action: PlatformAuditAction.SUPPORT_ENDED,
          entity: 'SupportSession',
          entityId: id,
          organizationId: session.organizationId,
          storeId: session.storeId,
        },
        actor,
        tx,
      );
      return updated;
    });
    const supportUser = await this.supportUser();
    await this.inStore(session.storeId, supportUser, id, () =>
      this.storeAudit.log({
        action: AuditAction.SUPPORT_ENDED,
        entity: 'SupportSession',
        entityId: id,
      }),
    );
    this.realtime.noticesUpdated(session.storeId);
    const [dto] = await this.dtos([ended]);
    return dto!;
  }

  /** Session data for the panel opened with a support token (no refresh: it ends at `endsAt`). */
  async panelSession(sessionId: string, accessToken: string): Promise<AuthSession> {
    const session = await this.prisma.supportSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt || session.endsAt <= new Date()) {
      throw new UnauthorizedError('O acesso de suporte terminou');
    }
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: session.storeId } });
    return {
      accessToken,
      expiresIn: Math.max(0, Math.floor((session.endsAt.getTime() - Date.now()) / 1000)),
      user: { id: await this.supportUser(), name: SUPPORT_USER_NAME, email: SUPPORT_USER_EMAIL },
      store: { id: store.id, slug: store.slug, tradeName: store.tradeName, logoUrl: store.logoUrl },
      // The panel shows what a manager sees; the API enforces the session mode.
      role: 'MANAGER',
      memberships: [{ storeId: store.id, tradeName: store.tradeName, role: 'MANAGER' }],
      support: { reason: session.reason, mode: session.mode, endsAt: session.endsAt.toISOString() },
    };
  }

  /** Active session of a store, for the banner everyone sees. */
  async activeForStore(storeId: string): Promise<SupportSession | null> {
    return this.prisma.supportSession.findFirst({
      where: { storeId, endedAt: null, endsAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async supportUser(): Promise<string> {
    const user = await this.prisma.user.upsert({
      where: { email: SUPPORT_USER_EMAIL },
      create: {
        email: SUPPORT_USER_EMAIL,
        name: SUPPORT_USER_NAME,
        passwordHash: UNUSABLE_PASSWORD,
      },
      update: {},
    });
    return user.id;
  }

  private inStore(
    storeId: string,
    userId: string,
    supportSessionId: string,
    fn: () => Promise<void>,
  ) {
    return this.ctx.run(storeId, async () => {
      this.ctx.set({ tenantId: storeId, userId, supportSessionId });
      await fn();
    });
  }

  private async dtos(sessions: SupportSession[]): Promise<SupportSessionDto[]> {
    const admins = await this.directory.adminNames(sessions.map((s) => s.adminId));
    const stores = await this.prisma.store.findMany({
      where: { id: { in: [...new Set(sessions.map((s) => s.storeId))] } },
      select: { id: true, tradeName: true, organization: { select: { name: true } } },
    });
    return sessions.map((s) => {
      const store = stores.find((st) => st.id === s.storeId);
      return toSupportDto(s, {
        admin: admins.get(s.adminId),
        customer: store?.organization.name,
        store: store?.tradeName,
      });
    });
  }
}
