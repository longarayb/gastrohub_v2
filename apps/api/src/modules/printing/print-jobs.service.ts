import { Injectable } from '@nestjs/common';
import {
  type LeasedPrintJobDto,
  PRINT_LEASE_SECONDS,
  type PrintDocument,
  type PrintJobDto,
  type PrintLeaseDto,
  formatTime,
  type printAckSchema,
  type printJobsQuerySchema,
  printMarks,
  printTiming,
  retryDelayMs,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PrintAgentsService, toAgentPrinter } from './print-agents.service.js';
import { PrintQueueService } from './print-queue.service.js';
import { jobInclude, toJobDtos } from './printers.service.js';

/**
 * The print queue seen by the agent (lease and acknowledge) and by the panel (list, reprint,
 * held jobs, retry). Delivery is at-least-once (docs/DECISOES.md D036): a lease that expires
 * without an answer goes back to the queue marked "POSSÍVEL 2ª VIA"; a job older than the hold
 * limit waits for someone to choose between printing (marked as late) and discarding.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly queue: PrintQueueService,
    private readonly agents: PrintAgentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Agent

  async lease(max: number): Promise<PrintLeaseDto> {
    const agentId = this.ctx.deviceId!;
    const now = new Date();
    const { holdAfterMinutes } = await this.queue.settings();
    const candidates = await this.db.printJob.findMany({
      where: {
        printer: { agentId, deletedAt: null, active: true },
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'LEASED', leaseUntil: { lt: now } },
        ],
      },
      include: { printer: true },
      orderBy: { createdAt: 'asc' },
      take: max,
    });
    const jobs: LeasedPrintJobDto[] = [];
    let held = 0;
    for (const job of candidates) {
      const expired = job.status === 'LEASED';
      const timing = job.releasedAt
        ? 'PRINT_DELAYED'
        : printTiming(job.createdAt, now, holdAfterMinutes);
      // Conditional updates: two leases at the same time never take the same job.
      const where = { id: job.id, status: job.status, attempts: job.attempts };
      if (timing === 'HOLD') {
        const { count } = await this.db.printJob.updateMany({
          where,
          data: {
            status: 'HELD',
            heldAt: now,
            leaseUntil: null,
            ...(expired && { possibleDuplicate: true }),
          },
        });
        held += count;
        continue;
      }
      const possibleDuplicate = job.possibleDuplicate || expired;
      const { count } = await this.db.printJob.updateMany({
        where,
        data: {
          status: 'LEASED',
          attempts: { increment: 1 },
          leasedAt: now,
          leaseUntil: new Date(now.getTime() + PRINT_LEASE_SECONDS * 1000),
          possibleDuplicate,
          ...(expired && {
            failingSince: job.failingSince ?? now,
            lastError: 'Sem resposta do computador',
          }),
        },
      });
      if (!count) continue;
      jobs.push({
        id: job.id,
        attempt: job.attempts + 1,
        kind: job.kind,
        printer: toAgentPrinter(job.printer),
        copies: job.copies,
        document: printMarks(job.document as unknown as PrintDocument, {
          delayedFrom: timing === 'PRINT_DELAYED' ? formatTime(job.createdAt) : undefined,
          possibleDuplicate,
          reprint: !!job.reprintOfId,
        }),
      });
    }
    if (held) this.realtime.printingUpdated(this.ctx.tenantId);
    const printers = await this.db.printer.findMany({
      where: { agentId, active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { jobs, printers: printers.map(toAgentPrinter) };
  }

  async ack(id: string, input: z.output<typeof printAckSchema>): Promise<{ accepted: boolean }> {
    const agentId = this.ctx.deviceId!;
    const job = await this.db.printJob.findFirst({ where: { id, printer: { agentId } } });
    if (!job) throw new NotFoundError('Impressão');
    const now = new Date();
    // A late answer of an attempt that was already given to someone else is ignored.
    const where = { id, status: 'LEASED' as const, attempts: input.attempt };
    const { count } = await this.db.printJob.updateMany({
      where,
      data:
        input.result === 'PRINTED'
          ? {
              status: 'PRINTED',
              printedAt: now,
              leaseUntil: null,
              lastError: null,
              failingSince: null,
            }
          : {
              status: 'PENDING',
              leaseUntil: null,
              lastError: input.error ?? 'Falha ao imprimir',
              failingSince: job.failingSince ?? now,
              nextAttemptAt: new Date(now.getTime() + retryDelayMs(input.attempt)),
            },
    });
    if (input.printerStatus) {
      await this.agents.updatePrinterStatus(
        job.printerId,
        input.printerStatus,
        input.result === 'FAILED' ? (input.error ?? null) : null,
        now,
      );
    }
    this.realtime.printingUpdated(this.ctx.tenantId);
    return { accepted: count > 0 };
  }

  // ---------------------------------------------------------------------------
  // Panel

  async list(query: z.output<typeof printJobsQuerySchema>): Promise<PrintJobDto[]> {
    const rows = await this.db.printJob.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.orderId && { orderId: query.orderId }),
      },
      include: jobInclude,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return toJobDtos(this.db, rows);
  }

  private async find(id: string) {
    const job = await this.db.printJob.findFirst({ where: { id } });
    if (!job) throw new NotFoundError('Impressão');
    return job;
  }

  async preview(id: string): Promise<{ document: PrintDocument; paperWidth: number }> {
    const job = await this.db.printJob.findFirst({ where: { id }, include: { printer: true } });
    if (!job) throw new NotFoundError('Impressão');
    return {
      document: job.document as unknown as PrintDocument,
      paperWidth: job.printer.paperWidth,
    };
  }

  /** Second copy, marked "2ª VIA", on the same printer or another one. */
  async reprint(id: string, printerId?: string): Promise<PrintJobDto> {
    const original = await this.find(id);
    const target = await this.queue.usablePrinter(this.db, printerId ?? original.printerId);
    if (!target) throw new ValidationError('Impressora indisponível. Escolha outra.');
    const created = await this.db.$transaction(async (tx) => {
      const job = await tx.printJob.create({
        data: {
          printerId: target.id,
          kind: original.kind,
          title: original.title,
          document: original.document as Prisma.InputJsonValue,
          copies: 1,
          orderId: original.orderId,
          reprintOfId: original.reprintOfId ?? original.id,
          createdById: this.ctx.userId ?? null,
        },
        include: jobInclude,
      });
      await this.audit.log(
        {
          action: AuditAction.PRINT_REPRINT,
          entity: 'PrintJob',
          entityId: original.id,
          after: { kind: original.kind, title: original.title, printerId: target.id },
        },
        tx,
      );
      return job;
    });
    this.queue.markQueued();
    await this.queue.flush();
    return (await toJobDtos(this.db, [created]))[0]!;
  }

  /** A held (old) job: print now, marked as late, or discard it. */
  async decideHeld(id: string, action: 'PRINT' | 'DISCARD'): Promise<PrintJobDto> {
    const job = await this.find(id);
    if (job.status !== 'HELD') throw new ValidationError('Esta impressão não está retida');
    const now = new Date();
    const { count } = await this.db.printJob.updateMany({
      where: { id, status: 'HELD' },
      data:
        action === 'PRINT'
          ? {
              status: 'PENDING',
              releasedAt: now,
              releasedById: this.ctx.userId ?? null,
              nextAttemptAt: now,
            }
          : { status: 'DISCARDED', discardedAt: now, discardedById: this.ctx.userId ?? null },
    });
    if (!count) throw new ValidationError('Esta impressão já foi decidida por outra pessoa');
    if (action === 'DISCARD') {
      await this.audit.log({
        action: AuditAction.PRINT_JOB_DISCARDED,
        entity: 'PrintJob',
        entityId: id,
        before: { kind: job.kind, title: job.title, createdAt: job.createdAt },
      });
      this.realtime.printingUpdated(this.ctx.tenantId);
    } else {
      this.queue.markQueued();
      await this.queue.flush();
    }
    return this.dto(id);
  }

  /** Try again now (after fixing paper, cable or the agent), without waiting for the backoff. */
  async retry(id: string): Promise<PrintJobDto> {
    const job = await this.find(id);
    if (job.status !== 'PENDING') throw new ValidationError('Esta impressão não está na fila');
    await this.db.printJob.updateMany({
      where: { id, status: 'PENDING' },
      data: { nextAttemptAt: new Date() },
    });
    this.queue.markQueued();
    await this.queue.flush();
    return this.dto(id);
  }

  private async dto(id: string): Promise<PrintJobDto> {
    const row = await this.db.printJob.findFirst({ where: { id }, include: jobInclude });
    if (!row) throw new NotFoundError('Impressão');
    return (await toJobDtos(this.db, [row]))[0]!;
  }
}
