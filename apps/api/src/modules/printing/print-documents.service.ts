import { Injectable } from '@nestjs/common';
import {
  type PrintDocument,
  type PrintJobKind,
  cashCloseDocument,
  courierSettlementDocument,
  deliveryCopyDocument,
  type printOrderSchema,
  type printPreBillSchema,
  preBillDocument,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ValidationError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CashService } from '../cash/cash.service.js';
import { PaymentsService } from '../cash/payments.service.js';
import { SettlementsService } from '../delivery/settlements.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrintQueueService } from './print-queue.service.js';

const NO_PRINTER =
  'Nenhuma impressora do caixa configurada. Escolha uma em Configurações › Impressão.';

/**
 * Documents printed on demand from the panel (docs/DECISOES.md D036): delivery copy, second
 * copy of the production tickets, pre-bill, cash close and courier settlement. The server builds
 * them from its own data (never a document sent by the browser). Without a printer in the
 * request, the store's cash printer is used.
 */
@Injectable()
export class PrintDocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly queue: PrintQueueService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly cash: CashService,
    private readonly settlements: SettlementsService,
  ) {}

  private async printer(printerId: string | undefined) {
    const id = printerId ?? (await this.queue.settings()).cashPrinterId;
    const printer = await this.queue.usablePrinter(this.db, id);
    if (!printer) throw new ValidationError(printerId ? 'Impressora indisponível' : NO_PRINTER);
    return printer;
  }

  private async print(
    printerId: string | undefined,
    job: { kind: PrintJobKind; document: PrintDocument; orderId?: string; copies?: number },
  ): Promise<{ queued: number }> {
    const printer = await this.printer(printerId);
    await this.db.$transaction(async (tx) => {
      await this.queue.enqueue(tx, { ...job, printerId: printer.id });
    });
    await this.queue.flush();
    return { queued: 1 };
  }

  async order(id: string, input: z.output<typeof printOrderSchema>): Promise<{ queued: number }> {
    if (input.document === 'DELIVERY_COPY') return this.deliveryCopy(id, input.printerId);
    return this.kitchenTickets(id, input.printerId);
  }

  /** Delivery copy on demand; a second one is marked "2ª VIA". */
  private async deliveryCopy(id: string, printerId?: string): Promise<{ queued: number }> {
    const order = await this.orders.get(id);
    if (order.type !== 'DELIVERY')
      throw new ValidationError('Via de entrega só em pedidos de delivery');
    const printer = await this.printer(printerId);
    const first = await this.db.printJob.findFirst({
      where: { orderId: id, kind: 'DELIVERY_COPY', reprintOfId: null },
      orderBy: { seq: 'asc' },
      select: { id: true },
    });
    const document = deliveryCopyDocument({
      storeName: await this.queue.storeName(),
      order,
      mapsUrl: order.delivery?.links?.google ?? null,
    });
    await this.db.$transaction(async (tx) => {
      await tx.printJob.create({
        data: {
          printerId: printer.id,
          kind: 'DELIVERY_COPY',
          title: document.title,
          document: document as unknown as Prisma.InputJsonValue,
          orderId: id,
          reprintOfId: first?.id ?? null,
          createdById: this.ctx.userId ?? null,
        },
      });
      if (first) {
        await this.audit.log(
          {
            action: AuditAction.PRINT_REPRINT,
            entity: 'Order',
            entityId: id,
            after: { kind: 'DELIVERY_COPY', number: order.number },
          },
          tx,
        );
      }
    });
    this.queue.markQueued();
    await this.queue.flush();
    return { queued: 1 };
  }

  /** Second copy of every production ticket of the order (each on its sector printer). */
  private async kitchenTickets(id: string, printerId?: string): Promise<{ queued: number }> {
    const target = printerId ? await this.printer(printerId) : null;
    const tickets = await this.db.printJob.findMany({
      where: {
        orderId: id,
        kind: 'KITCHEN_TICKET',
        reprintOfId: null,
        status: { not: 'DISCARDED' },
      },
      orderBy: { seq: 'asc' },
    });
    let queued = 0;
    await this.db.$transaction(async (tx) => {
      if (!tickets.length) {
        // Never printed (no printer at the time): print them now as originals.
        await this.queue.orderTickets(tx, id);
        queued = await tx.printJob.count({ where: { orderId: id, kind: 'KITCHEN_TICKET' } });
        return;
      }
      for (const ticket of tickets) {
        const printer = target ?? (await this.queue.usablePrinter(tx, ticket.printerId));
        if (!printer) continue;
        await tx.printJob.create({
          data: {
            printerId: printer.id,
            kind: 'KITCHEN_TICKET',
            title: ticket.title,
            document: ticket.document as Prisma.InputJsonValue,
            orderId: id,
            reprintOfId: ticket.id,
            createdById: this.ctx.userId ?? null,
          },
        });
        queued++;
      }
      if (queued) {
        await this.audit.log(
          {
            action: AuditAction.PRINT_REPRINT,
            entity: 'Order',
            entityId: id,
            after: { kind: 'KITCHEN_TICKET', queued },
          },
          tx,
        );
      }
    });
    if (!queued) {
      throw new ValidationError('Nenhum setor deste pedido tem impressora configurada');
    }
    this.queue.markQueued();
    await this.queue.flush();
    return { queued };
  }

  /** Pre-bill of a table: its tabs, optional split and PIX QR Code (single tab). */
  async preBill(input: z.output<typeof printPreBillSchema>): Promise<{ queued: number }> {
    const orders = [];
    for (const id of input.orderIds) orders.push(await this.orders.get(id));
    const sessions = new Set(orders.map((o) => o.tableSessionId));
    if (orders.some((o) => o.type !== 'DINE_IN') || sessions.size !== 1) {
      throw new ValidationError('A pré-conta é de contas de uma mesma mesa');
    }
    let pixCode: string | null = null;
    if (input.withPix && orders.length === 1 && orders[0]!.balanceCents > 0) {
      // Without a PIX key the pre-bill prints without the QR Code.
      pixCode = await this.payments
        .pixCharge(orders[0]!.id)
        .then((c) => c.brCode)
        .catch(() => null);
    }
    return this.print(input.printerId, {
      kind: 'PRE_BILL',
      orderId: orders.length === 1 ? orders[0]!.id : undefined,
      document: preBillDocument({
        storeName: await this.queue.storeName(),
        tableNames: orders[0]!.tableNames,
        orders,
        people: input.people,
        pixCode,
      }),
    });
  }

  async cashClose(id: string, printerId?: string): Promise<{ queued: number }> {
    const session = await this.cash.get(id);
    return this.print(printerId, {
      kind: 'CASH_CLOSE',
      document: cashCloseDocument({ storeName: await this.queue.storeName(), session }),
    });
  }

  async settlement(id: string, printerId?: string): Promise<{ queued: number }> {
    const settlement = await this.settlements.get(id);
    return this.print(printerId, {
      kind: 'COURIER_SETTLEMENT',
      document: courierSettlementDocument({ storeName: await this.queue.storeName(), settlement }),
    });
  }
}
