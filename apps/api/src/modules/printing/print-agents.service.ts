import { randomBytes, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type AgentPrinterDto,
  ErrorCode,
  KDS_PAIRING_CODE_LENGTH,
  KDS_PAIRING_MAX_FAILURES,
  KDS_PAIRING_TTL_MINUTES,
  PRINT_AGENT_ROLE,
  PRINT_AGENT_TTL_DAYS,
  type PaperWidth,
  type PrintAgentDto,
  type PrintAgentPairingCodeDto,
  type PrintAgentSessionDto,
  type PrinterStatus,
  agentOnline,
  type printAgentHeartbeatSchema,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  DomainError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { PrintAgent, Printer } from '../../generated/prisma/client.js';
import { TokenService, sha256 } from '../auth/token.service.js';
import { STORE_PAIRING_FAILURE_LIMIT } from '../kds/kds-devices.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const STORE_PAIRING_WINDOW_MINUTES = 15;
const INVALID_CODE = 'Código inválido ou expirado. Gere um novo código no painel.';
const NOT_PAIRED = 'Este computador não está vinculado. Vincule-o de novo pelo painel.';

class TooManyAttemptsError extends DomainError {
  constructor() {
    super(
      'Muitas tentativas de vínculo nesta unidade. Aguarde alguns minutos e gere um novo código.',
      ErrorCode.RATE_LIMITED,
      429,
    );
  }
}

export function toAgentDto(a: PrintAgent, now = new Date()): PrintAgentDto {
  const state = a.revokedAt ? 'REVOKED' : a.tokenHash ? 'PAIRED' : 'PENDING';
  return {
    id: a.id,
    name: a.name,
    state,
    online: state === 'PAIRED' && agentOnline(a.lastSeenAt, now),
    pairingExpiresAt:
      a.pairingCodeHash && a.pairingExpiresAt ? a.pairingExpiresAt.toISOString() : null,
    pairedAt: a.pairedAt?.toISOString() ?? null,
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    revokedAt: a.revokedAt?.toISOString() ?? null,
    version: a.version,
    hostname: a.hostname,
    os: a.os,
    memoryMb: a.memoryMb,
    windowsPrinters: a.windowsPrinters,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toAgentPrinter(p: Printer): AgentPrinterDto {
  return {
    id: p.id,
    name: p.name,
    connection: p.connection,
    address: p.address,
    profileId: p.profileId,
    paperWidth: p.paperWidth as PaperWidth,
    withoutAccents: p.withoutAccents,
  };
}

/** Pairing codes are compared within one store (store + code avoid cross-store guessing). */
const codeHash = (tenantId: string, code: string) => sha256(`print:${tenantId}:${code}`);

/**
 * Print agents (docs/DECISOES.md D035): a manager registers a computer and gets a 6-digit code;
 * the agent installed on that PC pairs with store + code (same limits as the kitchen screens)
 * and receives a long-lived credential that Windows keeps encrypted (DPAPI). The credential is
 * exchanged for short access tokens with the PRINT_AGENT role, which can only lease and
 * acknowledge jobs and report its printers. It is not rotated on use: a PC that loses power in
 * the middle of a renewal must not lose its pairing.
 */
@Injectable()
export class PrintAgentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Pairing and session renewal are public: the store comes from the slug or the credential.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Panel (printers:manage)

  async list(): Promise<PrintAgentDto[]> {
    const agents = await this.db.printAgent.findMany({ orderBy: { createdAt: 'asc' } });
    const now = new Date();
    return agents.map((a) => toAgentDto(a, now));
  }

  private newCode() {
    const code = String(randomInt(0, 10 ** KDS_PAIRING_CODE_LENGTH)).padStart(
      KDS_PAIRING_CODE_LENGTH,
      '0',
    );
    return { code, expiresAt: new Date(Date.now() + KDS_PAIRING_TTL_MINUTES * 60_000) };
  }

  private async storeSlug(): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { slug: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store.slug;
  }

  async create(input: { name: string }): Promise<PrintAgentPairingCodeDto> {
    const { code, expiresAt } = this.newCode();
    const agent = await this.db.printAgent.create({
      data: {
        name: input.name,
        pairingCodeHash: codeHash(this.ctx.tenantId, code),
        pairingExpiresAt: expiresAt,
        createdById: this.ctx.userId!,
      },
    });
    await this.audit.log({
      action: AuditAction.PRINT_AGENT_CREATED,
      entity: 'PrintAgent',
      entityId: agent.id,
      after: { name: agent.name },
    });
    this.realtime.printingUpdated(this.ctx.tenantId);
    return {
      agent: toAgentDto(agent),
      code,
      storeSlug: await this.storeSlug(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async find(id: string): Promise<PrintAgent> {
    const agent = await this.db.printAgent.findFirst({ where: { id } });
    if (!agent) throw new NotFoundError('Computador');
    return agent;
  }

  async rename(id: string, input: { name: string }): Promise<PrintAgentDto> {
    await this.find(id);
    const agent = await this.db.printAgent.update({ where: { id }, data: { name: input.name } });
    this.realtime.printingUpdated(this.ctx.tenantId);
    return toAgentDto(agent);
  }

  /** New code (first pairing, reinstalled Windows or another PC taking its place). */
  async pairingCode(id: string): Promise<PrintAgentPairingCodeDto> {
    const current = await this.find(id);
    if (current.revokedAt)
      throw new ValidationError('Este computador foi desvinculado; crie outro');
    const { code, expiresAt } = this.newCode();
    const agent = await this.db.printAgent.update({
      where: { id },
      data: {
        pairingCodeHash: codeHash(this.ctx.tenantId, code),
        pairingExpiresAt: expiresAt,
        pairingFailures: 0,
      },
    });
    await this.audit.log({
      action: AuditAction.PRINT_PAIRING_CODE,
      entity: 'PrintAgent',
      entityId: id,
    });
    return {
      agent: toAgentDto(agent),
      code,
      storeSlug: await this.storeSlug(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The agent loses access right away; its printers stop receiving jobs. */
  async revoke(id: string): Promise<PrintAgentDto> {
    const current = await this.find(id);
    const agent = await this.db.printAgent.update({
      where: { id },
      data: {
        revokedAt: current.revokedAt ?? new Date(),
        revokedById: current.revokedById ?? this.ctx.userId ?? null,
        tokenHash: null,
        tokenExpiresAt: null,
        pairingCodeHash: null,
        pairingExpiresAt: null,
      },
    });
    await this.audit.log({
      action: AuditAction.PRINT_AGENT_REVOKED,
      entity: 'PrintAgent',
      entityId: id,
      before: { name: current.name, hostname: current.hostname, pairedAt: current.pairedAt },
    });
    this.realtime.printAgentRevoked(id);
    this.realtime.printingUpdated(this.ctx.tenantId);
    return toAgentDto(agent);
  }

  // ---------------------------------------------------------------------------
  // Agent side (public: store slug + code, then the stored credential)

  private async issueCredential(agentId: string): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    await this.prisma.printAgent.update({
      where: { id: agentId },
      data: {
        tokenHash: sha256(token),
        tokenExpiresAt: new Date(Date.now() + PRINT_AGENT_TTL_DAYS * 86_400_000),
        lastSeenAt: new Date(),
      },
    });
    return token;
  }

  private async printersOf(client: Db | DbTx | PrismaService, agentId: string) {
    const printers = await client.printer.findMany({
      where: { agentId, active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return printers.map(toAgentPrinter);
  }

  private async session(agent: PrintAgent, refreshToken?: string): Promise<PrintAgentSessionDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: agent.tenantId },
      select: { id: true, tradeName: true, slug: true },
    });
    if (!store) throw new UnauthorizedError(NOT_PAIRED);
    return {
      accessToken: await this.tokens.signAccessToken({
        sub: agent.id,
        tenantId: agent.tenantId,
        role: PRINT_AGENT_ROLE,
      }),
      ...(refreshToken && { refreshToken }),
      expiresIn: this.tokens.accessTtlSeconds,
      agent: { id: agent.id, name: agent.name },
      store: { id: store.id, name: store.tradeName, slug: store.slug },
      printers: await this.printersOf(this.prisma, agent.id),
    };
  }

  async pair(
    input: { store: string; code: string; hostname?: string; version?: string },
    meta: { ip?: string },
  ): Promise<PrintAgentSessionDto> {
    const store = await this.prisma.store.findUnique({
      where: { slug: input.store },
      select: { id: true },
    });
    // Unknown store: same answer as a wrong code (nothing to learn by guessing slugs).
    if (!store) throw new ValidationError(INVALID_CODE);
    const tenantId = store.id;
    const now = new Date();
    const recentFailures = await this.prisma.auditLog.count({
      where: {
        tenantId,
        action: AuditAction.PRINT_PAIRING_FAILED,
        createdAt: { gte: new Date(now.getTime() - STORE_PAIRING_WINDOW_MINUTES * 60_000) },
      },
    });
    if (recentFailures >= STORE_PAIRING_FAILURE_LIMIT) throw new TooManyAttemptsError();

    const pending = await this.prisma.printAgent.findMany({
      where: {
        tenantId,
        revokedAt: null,
        pairingCodeHash: { not: null },
        pairingExpiresAt: { gt: now },
      },
    });
    const hash = codeHash(tenantId, input.code);
    const agent = pending.find((a) => a.pairingCodeHash === hash);
    if (!agent) {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          action: AuditAction.PRINT_PAIRING_FAILED,
          entity: 'PrintAgent',
          after: { ip: meta.ip ?? null },
        },
      });
      // Every pending code of the store counts the failure; 5 failures invalidate it.
      for (const a of pending) {
        const failures = a.pairingFailures + 1;
        await this.prisma.printAgent.update({
          where: { id: a.id },
          data:
            failures >= KDS_PAIRING_MAX_FAILURES
              ? { pairingFailures: failures, pairingCodeHash: null, pairingExpiresAt: null }
              : { pairingFailures: failures },
        });
      }
      throw new ValidationError(INVALID_CODE);
    }

    // Single use: the code is cleared in the same update that checks it.
    const { count } = await this.prisma.printAgent.updateMany({
      where: { id: agent.id, pairingCodeHash: hash },
      data: {
        pairingCodeHash: null,
        pairingExpiresAt: null,
        pairingFailures: 0,
        pairedAt: now,
        hostname: input.hostname ?? agent.hostname,
        version: input.version ?? agent.version,
      },
    });
    if (count === 0) throw new ValidationError(INVALID_CODE);
    const token = await this.issueCredential(agent.id);
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        action: AuditAction.PRINT_AGENT_PAIRED,
        entity: 'PrintAgent',
        entityId: agent.id,
        after: { ip: meta.ip ?? null, hostname: input.hostname ?? null },
      },
    });
    this.realtime.printingUpdated(tenantId);
    return this.session(agent, token);
  }

  /** Exchanges the stored credential for an access token (sliding expiry, same credential). */
  async renew(token: string): Promise<PrintAgentSessionDto> {
    const agent = await this.prisma.printAgent.findUnique({ where: { tokenHash: sha256(token) } });
    if (!agent || agent.revokedAt || !agent.tokenExpiresAt || agent.tokenExpiresAt < new Date()) {
      throw new UnauthorizedError(NOT_PAIRED);
    }
    await this.prisma.printAgent.update({
      where: { id: agent.id },
      data: {
        tokenExpiresAt: new Date(Date.now() + PRINT_AGENT_TTL_DAYS * 86_400_000),
        lastSeenAt: new Date(),
      },
    });
    return this.session(agent);
  }

  /** Every 30 s: the agent is alive, its version and memory, Windows printers, printer status. */
  async heartbeat(
    input: z.output<typeof printAgentHeartbeatSchema>,
  ): Promise<{ printers: AgentPrinterDto[]; pendingJobs: number; serverTime: string }> {
    const agentId = this.ctx.deviceId!;
    const now = new Date();
    const before = await this.find(agentId);
    await this.db.printAgent.update({
      where: { id: agentId },
      data: {
        lastSeenAt: now,
        version: input.version,
        hostname: input.hostname,
        os: input.os ?? before.os,
        memoryMb: Math.round(input.memoryMb * 10) / 10,
        windowsPrinters: input.windowsPrinters,
      },
    });
    let changed = !agentOnline(before.lastSeenAt, now);
    const own = await this.db.printer.findMany({
      where: { agentId, deletedAt: null },
      select: { id: true, status: true, statusDetail: true },
    });
    for (const report of input.printers) {
      const printer = own.find((p) => p.id === report.id);
      if (!printer) continue;
      const detail = report.detail ?? null;
      if (printer.status === report.status && printer.statusDetail === detail) continue;
      await this.updatePrinterStatus(printer.id, report.status, detail, now);
      changed = true;
    }
    if (changed) this.realtime.printingUpdated(this.ctx.tenantId);
    const pendingJobs = await this.db.printJob.count({
      where: { status: 'PENDING', printer: { agentId, deletedAt: null } },
    });
    return {
      printers: await this.printersOf(this.db, agentId),
      pendingJobs,
      serverTime: now.toISOString(),
    };
  }

  async updatePrinterStatus(
    printerId: string,
    status: PrinterStatus,
    detail: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.printer.update({
      where: { id: printerId },
      data: { status, statusDetail: detail, statusAt: now },
    });
  }
}
