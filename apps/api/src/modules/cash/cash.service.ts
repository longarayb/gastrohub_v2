import { Injectable } from '@nestjs/common';
import {
  type CashMovementInput,
  type CashPaymentRowDto,
  type CashSessionDetailDto,
  type CashSessionDto,
  type CashSessionTotals,
  type CurrentCashDto,
  CASH_REGISTER_METHODS,
  Permission,
  cashSessionCount,
  cashSessionTotals,
  currentBusinessDay,
  hasPermission,
  withdrawalError,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { Prisma, type CashSession } from '../../generated/prisma/client.js';
import { MenuContext } from '../menu/menu-common.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const CONFLICT_MESSAGE =
  'O caixa teve movimentação enquanto você conferia. Os valores foram atualizados; confira e tente de novo.';

const sessionInclude = {
  movements: { orderBy: { createdAt: 'asc' } },
  counts: true,
  payments: { include: { order: { select: { number: true, businessDate: true } } } },
  refunds: { include: { order: { select: { number: true, businessDate: true } } } },
} satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

/** Totals of a register from its rows (same rules as the closing report). */
function totalsOf(session: SessionRow): CashSessionTotals {
  return cashSessionTotals({
    openingCents: session.openingCents,
    movements: session.movements,
    received: session.payments,
    refunded: session.refunds,
  });
}

/**
 * Cash register of each operator (docs/DECISOES.md D024): one open register per operator,
 * opening float, supplies/withdrawals, closing count with the difference per method, reopening
 * by a manager. Payments and refunds lock the open register row (version bump), so a payment
 * can never slip into a register that is being closed.
 */
@Injectable()
export class CashService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (blind close setting) and user names are not tenant-scoped models.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  private get userId(): string {
    const id = this.ctx.userId;
    if (!id) throw new ForbiddenError('Operação exige um usuário autenticado');
    return id;
  }

  private canManage(): boolean {
    return hasPermission(this.ctx.role, Permission.CASH_MANAGE);
  }

  private async store() {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { timezone: true, blindCashClose: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  // ---------------------------------------------------------------------------
  // Used by payments

  /** The open register of a user, locked for this transaction (version bump). */
  async lockOpenSession(tx: DbTx, userId: string): Promise<CashSession | null> {
    const session = await tx.cashSession.findFirst({ where: { openOperatorId: userId } });
    if (!session) return null;
    const { count } = await tx.cashSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: { version: { increment: 1 } },
    });
    return count === 1 ? session : null;
  }

  /** Current totals of a register, inside a transaction. */
  async totals(tx: DbTx, sessionId: string): Promise<CashSessionTotals> {
    const session = await tx.cashSession.findFirst({
      where: { id: sessionId },
      include: sessionInclude,
    });
    if (!session) throw new NotFoundError('Caixa');
    return totalsOf(session);
  }

  notify(sessionId: string): void {
    this.realtime.cashUpdated(this.ctx.tenantId, sessionId);
  }

  // ---------------------------------------------------------------------------
  // Queries

  private async findRow(id: string, client: Db | DbTx = this.db): Promise<SessionRow> {
    const session = await client.cashSession.findFirst({ where: { id }, include: sessionInclude });
    if (!session) throw new NotFoundError('Caixa');
    if (session.operatorId !== this.ctx.userId && !this.canManage()) {
      throw new ForbiddenError('Este caixa é de outro operador');
    }
    return session;
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** Blind close: while open, operators without cash:manage do not see what is expected. */
  private hidesTotals(session: CashSession, blindClose: boolean): boolean {
    return session.status === 'OPEN' && blindClose && !this.canManage();
  }

  private toDto(
    session: SessionRow,
    names: Map<string, string>,
    blindClose: boolean,
  ): CashSessionDto {
    const totals = totalsOf(session);
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    const countedDifference = session.counts.reduce((t, c) => t + c.differenceCents, 0);
    return {
      id: session.id,
      businessDate: session.businessDate,
      status: session.status,
      operatorId: session.operatorId,
      operatorName: name(session.operatorId) ?? '—',
      openingCents: session.openingCents,
      openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      closedByName: name(session.closedById),
      closingNotes: session.closingNotes,
      reopenedAt: session.reopenedAt?.toISOString() ?? null,
      reopenedByName: name(session.reopenedById),
      reopenReason: session.reopenReason,
      version: session.version,
      paymentCount: session.payments.length,
      totals: this.hidesTotals(session, blindClose)
        ? null
        : {
            suppliesCents: totals.suppliesCents,
            withdrawalsCents: totals.withdrawalsCents,
            expectedCashCents: totals.expectedCashCents,
            expectedCents: totals.expectedCents,
            methods: totals.methods,
          },
      counts: session.counts
        .map((c) => ({
          method: c.method,
          expectedCents: c.expectedCents,
          countedCents: c.countedCents,
          differenceCents: c.differenceCents,
        }))
        .sort(
          (a, b) =>
            CASH_REGISTER_METHODS.indexOf(a.method) - CASH_REGISTER_METHODS.indexOf(b.method),
        ),
      differenceCents: session.status === 'CLOSED' ? countedDifference : null,
    };
  }

  private async toDetail(session: SessionRow, blindClose: boolean): Promise<CashSessionDetailDto> {
    const names = await this.userNames([
      session.operatorId,
      session.closedById,
      session.reopenedById,
      ...session.movements.map((m) => m.createdById),
    ]);
    const dto = this.toDto(session, names, blindClose);
    const rows: CashPaymentRowDto[] = [
      ...session.payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        orderNumber: p.order.number,
        businessDate: p.order.businessDate,
        method: p.method,
        amountCents: p.amountCents,
        changeCents: p.changeCents,
        status: p.status,
        kind: 'received' as const,
        at: p.createdAt.toISOString(),
      })),
      ...session.refunds.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        orderNumber: p.order.number,
        businessDate: p.order.businessDate,
        method: p.method,
        amountCents: p.amountCents,
        changeCents: null,
        status: p.status,
        kind: 'refunded' as const,
        at: (p.refundedAt ?? p.createdAt).toISOString(),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      ...dto,
      movements: session.movements.map((m) => ({
        id: m.id,
        type: m.type,
        amountCents: m.amountCents,
        reason: m.reason,
        createdByName: names.get(m.createdById) ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      // In blind mode the amounts would reveal the expected totals.
      payments: dto.totals ? rows : [],
    };
  }

  async current(): Promise<CurrentCashDto> {
    const store = await this.store();
    const session = await this.db.cashSession.findFirst({
      where: { openOperatorId: this.userId },
      include: sessionInclude,
    });
    return {
      session: session ? await this.toDetail(session, store.blindCashClose) : null,
      blindClose: store.blindCashClose,
    };
  }

  async get(id: string): Promise<CashSessionDetailDto> {
    const store = await this.store();
    return this.toDetail(await this.findRow(id), store.blindCashClose);
  }

  /** Registers of a day (managers see everyone's; operators only their own). */
  async list(query: {
    businessDate?: string;
    status?: 'OPEN' | 'CLOSED';
  }): Promise<CashSessionDto[]> {
    const store = await this.store();
    const sessions = await this.db.cashSession.findMany({
      where: {
        ...(query.businessDate && { businessDate: query.businessDate }),
        ...(query.status && { status: query.status }),
        ...(!this.canManage() && { operatorId: this.userId }),
      },
      include: sessionInclude,
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    const names = await this.userNames(
      sessions.flatMap((s) => [s.operatorId, s.closedById, s.reopenedById]),
    );
    return sessions.map((s) => this.toDto(s, names, store.blindCashClose));
  }

  // ---------------------------------------------------------------------------
  // Commands

  async open(input: { openingCents: number }): Promise<CashSessionDetailDto> {
    const userId = this.userId;
    const store = await this.store();
    const businessDay = currentBusinessDay(await this.menu.hours(), new Date(), store.timezone);
    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        const session = await tx.cashSession.create({
          data: {
            businessDate: businessDay.date,
            operatorId: userId,
            openOperatorId: userId,
            openingCents: input.openingCents,
            openedById: userId,
          },
        });
        await this.audit.log(
          {
            action: AuditAction.CASH_OPENED,
            entity: 'CashSession',
            entityId: session.id,
            after: { openingCents: input.openingCents, businessDate: businessDay.date },
          },
          tx,
        );
        return session.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Você já tem um caixa aberto');
      }
      throw error;
    }
    this.notify(id);
    return this.toDetail(await this.findRow(id), store.blindCashClose);
  }

  async addMovement(input: CashMovementInput): Promise<CashSessionDetailDto> {
    const userId = this.userId;
    const store = await this.store();
    const sessionId = await this.db.$transaction(async (tx) => {
      const session = await this.lockOpenSession(tx, userId);
      if (!session)
        throw new ValidationError('Abra o caixa antes de registrar sangria ou suprimento');
      if (input.type === 'WITHDRAWAL') {
        const totals = await this.totals(tx, session.id);
        const error = withdrawalError(totals.expectedCashCents, input.amountCents);
        if (error) throw new ValidationError(error);
      }
      const movement = await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          type: input.type,
          amountCents: input.amountCents,
          reason: input.reason,
          createdById: userId,
        },
      });
      await this.audit.log(
        {
          action: AuditAction.CASH_MOVEMENT,
          entity: 'CashSession',
          entityId: session.id,
          reason: input.reason,
          after: { movementId: movement.id, type: input.type, amountCents: input.amountCents },
        },
        tx,
      );
      return session.id;
    });
    this.notify(sessionId);
    return this.toDetail(await this.findRow(sessionId), store.blindCashClose);
  }

  async close(
    id: string,
    input: {
      expectedVersion: number;
      counts: { method: CashSessionCountMethod; countedCents: number }[];
      notes: string | null;
    },
  ): Promise<CashSessionDetailDto> {
    const userId = this.userId;
    const store = await this.store();
    await this.db.$transaction(async (tx) => {
      const session = await this.findRow(id, tx);
      if (session.status !== 'OPEN') throw new ValidationError('Este caixa já está fechado');
      const counted = Object.fromEntries(input.counts.map((c) => [c.method, c.countedCents]));
      const count = cashSessionCount(totalsOf(session), counted);
      const { count: updated } = await tx.cashSession.updateMany({
        where: { id, status: 'OPEN', version: input.expectedVersion },
        data: {
          status: 'CLOSED',
          openOperatorId: null,
          closedAt: new Date(),
          closedById: userId,
          closingNotes: input.notes,
          version: { increment: 1 },
        },
      });
      if (updated === 0) throw new ConflictError(CONFLICT_MESSAGE);
      await tx.cashSessionCount.createMany({
        data: count.lines.map((line) => ({ sessionId: id, ...line })),
      });
      await this.audit.log(
        {
          action: AuditAction.CASH_CLOSED,
          entity: 'CashSession',
          entityId: id,
          reason: input.notes ?? undefined,
          after: {
            expectedCents: count.expectedCents,
            countedCents: count.countedCents,
            differenceCents: count.differenceCents,
            lines: count.lines,
          },
        },
        tx,
      );
    });
    this.notify(id);
    return this.toDetail(await this.findRow(id), store.blindCashClose);
  }

  /** Reopens a closed register (cash:manage, reason, audit with the previous count). */
  async reopen(
    id: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<CashSessionDetailDto> {
    if (!this.canManage()) throw new ForbiddenError('Somente gerentes podem reabrir um caixa');
    const userId = this.userId;
    const store = await this.store();
    try {
      await this.db.$transaction(async (tx) => {
        const session = await this.findRow(id, tx);
        if (session.status !== 'CLOSED') throw new ValidationError('Este caixa já está aberto');
        const { count } = await tx.cashSession.updateMany({
          where: { id, status: 'CLOSED', version: input.expectedVersion },
          data: {
            status: 'OPEN',
            openOperatorId: session.operatorId,
            closedAt: null,
            closedById: null,
            reopenedAt: new Date(),
            reopenedById: userId,
            reopenReason: input.reason,
            version: { increment: 1 },
          },
        });
        if (count === 0) throw new ConflictError(CONFLICT_MESSAGE);
        await tx.cashSessionCount.deleteMany({ where: { sessionId: id } });
        await this.audit.log(
          {
            action: AuditAction.CASH_REOPENED,
            entity: 'CashSession',
            entityId: id,
            reason: input.reason,
            before: {
              closedAt: session.closedAt,
              closingNotes: session.closingNotes,
              counts: session.counts.map((c) => ({
                method: c.method,
                expectedCents: c.expectedCents,
                countedCents: c.countedCents,
                differenceCents: c.differenceCents,
              })),
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('O operador deste caixa já tem outro caixa aberto');
      }
      throw error;
    }
    this.notify(id);
    return this.toDetail(await this.findRow(id), store.blindCashClose);
  }
}

type CashSessionCountMethod = Prisma.CashSessionCountCreateManyInput['method'];
