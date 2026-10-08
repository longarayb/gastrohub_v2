import { Injectable } from '@nestjs/common';
import {
  FAILING_ALERT_MS,
  type PaperWidth,
  type PrintJobDto,
  type PrintSettingsDto,
  type PrintStatusDto,
  type PrinterDto,
  type SectorPrinterDto,
  agentOnline,
  type printerSchema,
  type printSettingsSchema,
  printerProfile,
  type sectorPrintersSchema,
  testPageDocument,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PrintAgentsService } from './print-agents.service.js';
import { PrintQueueService } from './print-queue.service.js';

type PrinterData = z.output<typeof printerSchema>;

const jobInclude = {
  printer: { select: { name: true } },
} satisfies Prisma.PrintJobInclude;
type JobRow = Prisma.PrintJobGetPayload<{ include: typeof jobInclude }>;

/** Waiting or failing for a while (agent off, printer off, no paper): shown as an alert. */
export function isFailing(
  job: { status: string; failingSince: Date | null; createdAt: Date },
  now: Date,
) {
  if (job.status !== 'PENDING' && job.status !== 'LEASED') return false;
  return now.getTime() - (job.failingSince ?? job.createdAt).getTime() > FAILING_ALERT_MS;
}

export async function toJobDtos(db: Db, rows: JobRow[], now = new Date()): Promise<PrintJobDto[]> {
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))] as string[];
  const orders = orderIds.length
    ? await db.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, number: true },
      })
    : [];
  const numbers = new Map(orders.map((o) => [o.id, o.number]));
  return rows.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    title: j.title,
    printerId: j.printerId,
    printerName: j.printer.name,
    copies: j.copies,
    attempts: j.attempts,
    lastError: j.lastError,
    orderId: j.orderId,
    orderNumber: j.orderId ? (numbers.get(j.orderId) ?? null) : null,
    reprintOfId: j.reprintOfId,
    createdAt: j.createdAt.toISOString(),
    printedAt: j.printedAt?.toISOString() ?? null,
    failing: isFailing(j, now),
  }));
}

export { jobInclude };

/**
 * Printers, sector mapping and print settings (docs/DECISOES.md D035–D036), plus the panel
 * status with its alerts. Each printer belongs to one agent (the PC it is connected to).
 */
@Injectable()
export class PrintersService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Print settings are columns of the Store (the tenant itself).
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly agents: PrintAgentsService,
    private readonly queue: PrintQueueService,
  ) {}

  async printers(): Promise<PrinterDto[]> {
    const [printers, settings] = await Promise.all([
      this.db.printer.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          agent: { select: { name: true } },
          sectors: { select: { id: true, name: true, printCopies: true } },
        },
      }),
      this.queue.settings(),
    ]);
    return printers.map((p) => ({
      id: p.id,
      name: p.name,
      agentId: p.agentId,
      agentName: p.agent.name,
      connection: p.connection,
      address: p.address,
      profileId: p.profileId,
      paperWidth: p.paperWidth as PaperWidth,
      withoutAccents: p.withoutAccents,
      active: p.active,
      status: p.status,
      statusDetail: p.statusDetail,
      statusAt: p.statusAt?.toISOString() ?? null,
      sectors: p.sectors.map((s) => ({ id: s.id, name: s.name, copies: s.printCopies })),
      isCashPrinter: settings.cashPrinterId === p.id,
    }));
  }

  private async validAgent(agentId: string): Promise<void> {
    const agent = await this.db.printAgent.findFirst({
      where: { id: agentId, revokedAt: null },
      select: { id: true },
    });
    if (!agent) throw new ValidationError('Computador não encontrado ou desvinculado');
  }

  private data(input: PrinterData) {
    return {
      name: input.name,
      agentId: input.agentId,
      connection: input.connection,
      address: input.connection === 'VIRTUAL' ? '' : input.address.trim(),
      profileId: input.profileId,
      paperWidth: input.paperWidth,
      withoutAccents: input.withoutAccents,
      active: input.active,
    };
  }

  async create(input: PrinterData): Promise<PrinterDto> {
    await this.validAgent(input.agentId);
    const printer = await this.db.printer.create({ data: this.data(input) });
    await this.audit.log({
      action: AuditAction.PRINTER_CREATED,
      entity: 'Printer',
      entityId: printer.id,
      after: this.data(input),
    });
    return this.changed(printer.id);
  }

  private async find(id: string) {
    const printer = await this.db.printer.findFirst({ where: { id, deletedAt: null } });
    if (!printer) throw new NotFoundError('Impressora');
    return printer;
  }

  async update(id: string, input: PrinterData): Promise<PrinterDto> {
    const current = await this.find(id);
    if (current.agentId !== input.agentId) await this.validAgent(input.agentId);
    const data = this.data(input);
    // A new connection starts without a status until the agent reports it.
    const moved =
      current.agentId !== data.agentId ||
      current.connection !== data.connection ||
      current.address !== data.address;
    await this.db.printer.update({
      where: { id },
      data: { ...data, ...(moved && { status: 'UNKNOWN', statusDetail: null, statusAt: null }) },
    });
    await this.audit.log({
      action: AuditAction.PRINTER_UPDATED,
      entity: 'Printer',
      entityId: id,
      before: {
        name: current.name,
        agentId: current.agentId,
        connection: current.connection,
        address: current.address,
        profileId: current.profileId,
        paperWidth: current.paperWidth,
        withoutAccents: current.withoutAccents,
        active: current.active,
      },
      after: data,
    });
    return this.changed(id);
  }

  /** Removed printers stay for the history; sectors and the cash printer are unset. */
  async remove(id: string): Promise<void> {
    const current = await this.find(id);
    await this.db.$transaction(async (tx) => {
      await tx.printer.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await tx.productionSector.updateMany({ where: { printerId: id }, data: { printerId: null } });
      await tx.printJob.updateMany({
        where: { printerId: id, status: { in: ['PENDING', 'HELD'] } },
        data: { status: 'DISCARDED', discardedAt: new Date(), lastError: 'Impressora removida' },
      });
    });
    await this.prisma.store.updateMany({
      where: { id: this.ctx.tenantId, printCashPrinterId: id },
      data: { printCashPrinterId: null },
    });
    await this.audit.log({
      action: AuditAction.PRINTER_REMOVED,
      entity: 'Printer',
      entityId: id,
      before: { name: current.name, connection: current.connection, address: current.address },
    });
    this.realtime.printingUpdated(this.ctx.tenantId);
  }

  private async changed(id: string): Promise<PrinterDto> {
    this.realtime.printingUpdated(this.ctx.tenantId);
    // The agent reloads its printers on the next heartbeat or nudge.
    const printer = await this.db.printer.findFirst({ where: { id }, select: { agentId: true } });
    if (printer) this.realtime.printJobs(this.ctx.tenantId, [printer.agentId]);
    const dto = (await this.printers()).find((p) => p.id === id);
    if (!dto) throw new NotFoundError('Impressora');
    return dto;
  }

  // ---------------------------------------------------------------------------
  // Settings and sectors

  async sectors(): Promise<SectorPrinterDto[]> {
    const sectors = await this.db.productionSector.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, printerId: true, printCopies: true },
    });
    return sectors.map((s) => ({
      sectorId: s.id,
      name: s.name,
      printerId: s.printerId,
      copies: s.printCopies,
    }));
  }

  private async validPrinters(ids: (string | null)[]): Promise<void> {
    const wanted = [...new Set(ids.filter(Boolean))] as string[];
    if (!wanted.length) return;
    const found = await this.db.printer.count({ where: { id: { in: wanted }, deletedAt: null } });
    if (found !== wanted.length) throw new ValidationError('Impressora não encontrada');
  }

  async updateSectors(input: z.output<typeof sectorPrintersSchema>): Promise<SectorPrinterDto[]> {
    await this.validPrinters(input.sectors.map((s) => s.printerId));
    const before = await this.sectors();
    const ids = input.sectors.map((s) => s.sectorId);
    const found = await this.db.productionSector.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ValidationError('Setor não encontrado');
    await this.db.$transaction(async (tx) => {
      for (const s of input.sectors) {
        await tx.productionSector.update({
          where: { id: s.sectorId },
          data: { printerId: s.printerId, printCopies: s.copies },
        });
      }
    });
    const after = await this.sectors();
    await this.audit.log({
      action: AuditAction.PRINT_SETTINGS_UPDATED,
      entity: 'ProductionSector',
      before: { sectors: before },
      after: { sectors: after },
    });
    this.realtime.printingUpdated(this.ctx.tenantId);
    return after;
  }

  async updateSettings(input: z.output<typeof printSettingsSchema>): Promise<PrintSettingsDto> {
    await this.validPrinters([input.cashPrinterId]);
    const before = await this.queue.settings();
    await this.prisma.store.update({
      where: { id: this.ctx.tenantId },
      data: {
        printCashPrinterId: input.cashPrinterId,
        printDeliveryCopyOnAccept: input.deliveryCopyOnAccept,
        printDeliveryCopies: input.deliveryCopies,
        printCancelSlips: input.cancelSlips,
        printHoldAfterMinutes: input.holdAfterMinutes,
      },
    });
    const after = await this.queue.settings();
    await this.audit.log({
      action: AuditAction.PRINT_SETTINGS_UPDATED,
      entity: 'Store',
      entityId: this.ctx.tenantId,
      before,
      after,
    });
    this.realtime.printingUpdated(this.ctx.tenantId);
    return after;
  }

  // ---------------------------------------------------------------------------
  // Test page and status

  /** Test page with the accents line, the model and the paper width (shows what to adjust). */
  async test(id: string): Promise<{ queued: boolean }> {
    const printer = await this.find(id);
    const agent = await this.db.printAgent.findFirst({ where: { id: printer.agentId } });
    const profile = printerProfile(printer.profileId);
    await this.db.$transaction(async (tx) => {
      await this.queue.enqueue(tx, {
        printerId: printer.id,
        kind: 'TEST_PAGE',
        document: testPageDocument({
          storeName: await this.queue.storeName(),
          printerName: printer.name,
          agentName: agent?.name ?? '',
          profile,
          width: printer.paperWidth as PaperWidth,
          withoutAccents: printer.withoutAccents,
        }),
      });
    });
    await this.queue.flush();
    return { queued: true };
  }

  async status(): Promise<PrintStatusDto> {
    const now = new Date();
    const [agents, printers, settings, sectors, held, open] = await Promise.all([
      this.agents.list(),
      this.printers(),
      this.queue.settings(),
      this.sectors(),
      this.db.printJob.findMany({
        where: { status: 'HELD' },
        include: jobInclude,
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.db.printJob.findMany({
        where: { status: { in: ['PENDING', 'LEASED'] } },
        include: jobInclude,
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ]);
    const failing = (await toJobDtos(this.db, open, now)).filter((j) => j.failing);
    const usedAgents = new Set(printers.filter((p) => p.active).map((p) => p.agentId));
    const offline = agents.filter(
      (a) => a.state === 'PAIRED' && usedAgents.has(a.id) && !agentOnline(a.lastSeenAt, now),
    );
    const printerProblems = printers.filter(
      (p) =>
        p.active && (p.status === 'PAPER_OUT' || p.status === 'OFFLINE' || p.status === 'ERROR'),
    );
    return {
      agents,
      printers,
      settings,
      sectors,
      held: await toJobDtos(this.db, held, now),
      failing: failing.slice(0, 50),
      alerts: offline.length + printerProblems.length + held.length + failing.length,
      serverTime: now.toISOString(),
    };
  }
}
