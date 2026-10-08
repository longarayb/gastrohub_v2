import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ORDER_SOURCE_LABELS,
  type PrintDocument,
  type PrintJobKind,
  type PrintSettingsDto,
  type TaskDetails,
  cancelSlipDocument,
  deliveryCopyDocument,
  kitchenTicketDocument,
  orderDisplayTitle,
} from '@app/shared';
import { ClsService } from 'nestjs-cls';
import { NotFoundError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { findFirstSequential } from '../../core/prisma/sequential.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import type { AppClsStore } from '../../core/tenancy/tenant-context.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { type OrderDetailRow, orderDetailInclude, toOrderDetail } from '../orders/orders.mapper.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface NewPrintJob {
  printerId: string;
  kind: PrintJobKind;
  document: PrintDocument;
  copies?: number;
  /** Automatic jobs are idempotent: the same key is never queued twice. */
  dedupeKey?: string | null;
  orderId?: string | null;
  reprintOfId?: string | null;
}

/** Statuses of a ticket that did not reach the printer yet (it can still be rewritten). */
const NOT_PRINTED = ['PENDING', 'HELD'] as const;

const shortHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export const ticketKey = (roundId: string, sectorId: string) => `ticket:${roundId}:${sectorId}`;

interface OrderHead {
  id: string;
  number: number;
  type: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  status: string;
  source: keyof typeof ORDER_SOURCE_LABELS;
  tabLabel: string | null;
  customerName: string | null;
  notes: string | null;
  tableSessionId: string | null;
}

interface TaskRow {
  roundId: string;
  sectorId: string;
  name: string;
  quantity: number;
  details: Prisma.JsonValue;
  status: string;
  orderItemId: string;
}

/**
 * Print queue (outbox, docs/DECISOES.md D036). Jobs are written in the same transaction as the
 * order change that causes them, so nothing is printed for a change that was rolled back and
 * nothing is lost if the agent is offline. Called by the order flows; agents are nudged after
 * the commit (`flush`).
 */
@Injectable()
export class PrintQueueService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Print settings live on the Store (the tenant itself) and user names are not tenant data.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly cls: ClsService<AppClsStore>,
    private readonly realtime: RealtimeService,
  ) {}

  async settings(): Promise<PrintSettingsDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: {
        printCashPrinterId: true,
        printDeliveryCopyOnAccept: true,
        printDeliveryCopies: true,
        printCancelSlips: true,
        printHoldAfterMinutes: true,
      },
    });
    if (!store) throw new NotFoundError('Unidade');
    return {
      cashPrinterId: store.printCashPrinterId,
      deliveryCopyOnAccept: store.printDeliveryCopyOnAccept,
      deliveryCopies: store.printDeliveryCopies,
      cancelSlips: store.printCancelSlips,
      holdAfterMinutes: store.printHoldAfterMinutes,
    };
  }

  async storeName(): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { tradeName: true },
    });
    return store?.tradeName ?? '';
  }

  /** An active printer that can receive jobs, or null. */
  async usablePrinter(client: Db | DbTx, printerId: string | null | undefined) {
    if (!printerId) return null;
    return client.printer.findFirst({
      where: { id: printerId, active: true, deletedAt: null, agent: { revokedAt: null } },
      select: { id: true, name: true, agentId: true },
    });
  }

  /** Queues a job; returns false when an automatic job with the same key already exists. */
  async enqueue(tx: DbTx, job: NewPrintJob): Promise<boolean> {
    const { count } = await tx.printJob.createMany({
      data: [
        {
          printerId: job.printerId,
          kind: job.kind,
          title: job.document.title,
          document: job.document as unknown as Prisma.InputJsonValue,
          copies: job.copies ?? 1,
          dedupeKey: job.dedupeKey ?? null,
          orderId: job.orderId ?? null,
          reprintOfId: job.reprintOfId ?? null,
          createdById: this.ctx.userId ?? null,
        },
      ],
      skipDuplicates: true,
    });
    if (count) this.markQueued();
    return count > 0;
  }

  /** A job was added outside `enqueue` (reprint, released or retried): nudge on `flush`. */
  markQueued(): void {
    this.cls.set('printQueued', true);
  }

  /** After the commit: tells the agents of the store there is something to lease. */
  async flush(): Promise<void> {
    if (!this.cls.isActive() || !this.cls.get('printQueued')) return;
    this.cls.set('printQueued', false);
    const agents = await this.db.printAgent.findMany({
      where: { revokedAt: null, tokenHash: { not: null } },
      select: { id: true },
    });
    this.realtime.printJobs(
      this.ctx.tenantId,
      agents.map((a) => a.id),
    );
  }

  // ---------------------------------------------------------------------------
  // Orders

  private async orderHead(tx: DbTx, orderId: string): Promise<OrderHead | null> {
    return tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        source: true,
        tabLabel: true,
        customerName: true,
        notes: true,
        tableSessionId: true,
      },
    });
  }

  private async title(tx: DbTx, order: OrderHead): Promise<string> {
    const tables = order.tableSessionId
      ? await tx.tableSessionTable.findMany({
          where: { sessionId: order.tableSessionId, leftAt: null },
          select: { table: { select: { name: true } } },
          orderBy: { joinedAt: 'asc' },
        })
      : [];
    return orderDisplayTitle({ ...order, tableNames: tables.map((t) => t.table.name) });
  }

  private ticket(
    order: OrderHead,
    title: string,
    round: { number: number; sentAt: Date | null; waiterName: string | null },
    sectorName: string,
    tasks: TaskRow[],
  ): PrintDocument {
    return kitchenTicketDocument({
      sectorName,
      orderNumber: order.number,
      orderType: order.type,
      title,
      roundNumber: round.number,
      sentAt: (round.sentAt ?? new Date()).toISOString(),
      waiterName: round.waiterName,
      sourceLabel: order.source === 'DIGITAL_MENU' ? ORDER_SOURCE_LABELS[order.source] : null,
      orderNotes: round.number === 1 ? order.notes : null,
      tasks: tasks.map((t) => ({
        name: t.name,
        quantity: t.quantity,
        details: t.details as unknown as TaskDetails,
      })),
      beep: true,
    });
  }

  private async rounds(tx: DbTx, orderId: string, roundIds?: string[]) {
    const rounds = await tx.orderRound.findMany({
      where: { orderId, sentAt: { not: null }, ...(roundIds && { id: { in: roundIds } }) },
      select: { id: true, number: true, sentAt: true, sentById: true },
    });
    const userIds = [...new Set(rounds.map((r) => r.sentById).filter(Boolean))] as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name.split(' ')[0] ?? u.name]));
    return new Map(
      rounds.map((r) => [
        r.id,
        { number: r.number, sentAt: r.sentAt, waiterName: names.get(r.sentById ?? '') ?? null },
      ]),
    );
  }

  private async printingSectors(tx: DbTx, sectorIds: string[]) {
    const sectors = await tx.productionSector.findMany({
      where: { id: { in: sectorIds }, printerId: { not: null } },
      select: { id: true, name: true, printerId: true, printCopies: true },
    });
    const usable = new Map<string, (typeof sectors)[number]>();
    for (const s of sectors) {
      if (await this.usablePrinter(tx, s.printerId)) usable.set(s.id, s);
    }
    return usable;
  }

  /**
   * Production tickets, one per round and sector with a printer. Only for orders the kitchen
   * should make (not pending acceptance, not canceled). `roundIds` limits to the rounds just
   * sent (items moved in from other tabs were already printed on their own ticket).
   */
  async orderTickets(tx: DbTx, orderId: string, roundIds?: string[]): Promise<void> {
    if (roundIds && !roundIds.length) return;
    const order = await this.orderHead(tx, orderId);
    if (!order || order.status === 'PENDING' || order.status === 'CANCELED') return;
    const rounds = await this.rounds(tx, orderId, roundIds);
    if (!rounds.size) return;
    const tasks = await tx.productionTask.findMany({
      where: { orderId, roundId: { in: [...rounds.keys()] }, status: { not: 'CANCELED' } },
      orderBy: { id: 'asc' },
      select: {
        roundId: true,
        sectorId: true,
        name: true,
        quantity: true,
        details: true,
        status: true,
        orderItemId: true,
      },
    });
    const sectors = await this.printingSectors(tx, [...new Set(tasks.map((t) => t.sectorId))]);
    if (!sectors.size) return;
    const title = await this.title(tx, order);
    const groups = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      if (!sectors.has(task.sectorId)) continue;
      const key = ticketKey(task.roundId, task.sectorId);
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
    for (const [key, group] of groups) {
      const sector = sectors.get(group[0]!.sectorId)!;
      const round = rounds.get(group[0]!.roundId)!;
      await this.enqueue(tx, {
        printerId: sector.printerId!,
        kind: 'KITCHEN_TICKET',
        document: this.ticket(order, title, round, sector.name, group),
        copies: sector.printCopies,
        dedupeKey: key,
        orderId,
      });
    }
  }

  /** Detail of an order inside a transaction (relations loaded one at a time). */
  async orderDetail(tx: DbTx, orderId: string) {
    const row = await findFirstSequential<OrderDetailRow>(tx.order, {
      where: { id: orderId },
      include: orderDetailInclude,
    });
    if (!row) throw new NotFoundError('Pedido');
    return toOrderDetail(row, new Map());
  }

  /** Delivery copy for the courier when a delivery order is accepted (setting, on by default). */
  async deliveryCopy(tx: DbTx, orderId: string): Promise<void> {
    const settings = await this.settings();
    if (!settings.deliveryCopyOnAccept) return;
    const printer = await this.usablePrinter(tx, settings.cashPrinterId);
    if (!printer) return;
    const order = await this.orderHead(tx, orderId);
    if (order?.type !== 'DELIVERY' || order.status === 'PENDING' || order.status === 'CANCELED') {
      return;
    }
    const detail = await this.orderDetail(tx, orderId);
    await this.enqueue(tx, {
      printerId: printer.id,
      kind: 'DELIVERY_COPY',
      document: deliveryCopyDocument({
        storeName: await this.storeName(),
        order: detail,
        mapsUrl: detail.delivery?.links?.google ?? null,
      }),
      copies: settings.deliveryCopies,
      dedupeKey: `delivery:${orderId}`,
      orderId,
    });
  }

  /**
   * Items (or the whole order) canceled after being sent. A ticket that did not print yet is
   * rewritten without them (or discarded when nothing is left); a ticket that printed (or may
   * have) gets a "CANCELADO" slip in its sector, when the store uses them.
   */
  async canceled(
    tx: DbTx,
    orderId: string,
    scope: { itemIds: string[] } | 'order',
    reason: string | null,
    now: Date,
  ): Promise<void> {
    const order = await this.orderHead(tx, orderId);
    if (!order) return;
    const canceled = await tx.productionTask.findMany({
      where: {
        orderId,
        status: 'CANCELED',
        ...(scope !== 'order' && { orderItemId: { in: scope.itemIds } }),
      },
      select: { roundId: true, sectorId: true, name: true, quantity: true, orderItemId: true },
    });
    if (!canceled.length) return;

    const slips = new Map<string, { name: string; quantity: number }[]>();
    const pairs = new Map<string, { roundId: string; sectorId: string }>();
    for (const t of canceled) pairs.set(ticketKey(t.roundId, t.sectorId), t);
    for (const [key, { roundId, sectorId }] of pairs) {
      const job = await tx.printJob.findFirst({
        where: { dedupeKey: key, status: { not: 'DISCARDED' } },
        select: { id: true, status: true },
      });
      if (!job) continue; // never queued: nothing on paper
      if ((NOT_PRINTED as readonly string[]).includes(job.status)) {
        if (await this.rewriteTicket(tx, order, job.id, roundId, sectorId, now)) continue;
      }
      const items = canceled.filter((t) => t.roundId === roundId && t.sectorId === sectorId);
      slips.set(sectorId, [
        ...(slips.get(sectorId) ?? []),
        ...items.map((t) => ({ name: t.name, quantity: t.quantity })),
      ]);
    }
    if (!slips.size) return;
    const settings = await this.settings();
    if (!settings.cancelSlips) return;
    const sectors = await this.printingSectors(tx, [...slips.keys()]);
    const title = await this.title(tx, order);
    for (const [sectorId, items] of slips) {
      const sector = sectors.get(sectorId);
      if (!sector) continue;
      const what = scope === 'order' ? 'order' : shortHash([...scope.itemIds].sort().join(','));
      await this.enqueue(tx, {
        printerId: sector.printerId!,
        kind: 'CANCEL_SLIP',
        document: cancelSlipDocument({
          sectorName: sector.name,
          orderNumber: order.number,
          title,
          canceledAt: now.toISOString(),
          wholeOrder: scope === 'order',
          items,
          reason,
        }),
        dedupeKey: `cancel:${orderId}:${sectorId}:${what}`,
        orderId,
      });
    }
  }

  /** Rewrites a ticket not printed yet; false when the agent took it meanwhile. */
  private async rewriteTicket(
    tx: DbTx,
    order: OrderHead,
    jobId: string,
    roundId: string,
    sectorId: string,
    now: Date,
  ): Promise<boolean> {
    const remaining = await tx.productionTask.findMany({
      where: { orderId: order.id, roundId, sectorId, status: { not: 'CANCELED' } },
      orderBy: { id: 'asc' },
      select: {
        roundId: true,
        sectorId: true,
        name: true,
        quantity: true,
        details: true,
        status: true,
        orderItemId: true,
      },
    });
    const where = { id: jobId, status: { in: [...NOT_PRINTED] } };
    if (!remaining.length) {
      const { count } = await tx.printJob.updateMany({
        where,
        data: { status: 'DISCARDED', discardedAt: now, lastError: 'Cancelado antes de imprimir' },
      });
      if (count) this.cls.set('printQueued', true);
      return count > 0;
    }
    const sector = await tx.productionSector.findFirst({
      where: { id: sectorId },
      select: { name: true },
    });
    const rounds = await this.rounds(tx, order.id, [roundId]);
    const round = rounds.get(roundId);
    if (!round) return false;
    const document = this.ticket(
      order,
      await this.title(tx, order),
      round,
      sector?.name ?? '',
      remaining,
    );
    const { count } = await tx.printJob.updateMany({
      where,
      data: { document: document as unknown as Prisma.InputJsonValue },
    });
    return count > 0;
  }
}
