import { Injectable } from '@nestjs/common';
import {
  type CreatePaymentInput,
  type OrderDetailDto,
  type PixChargeDto,
  type PixKeyType,
  buildPixBrCode,
  cashRefundError,
  formatBRL,
  isFinalStatus,
  preparePayment,
  usesCashRegister,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { OrdersService, paymentSummaryOf } from '../orders/orders.service.js';
import { CashService } from './cash.service.js';

/**
 * Payments of an order (docs/DECISOES.md D023): several per order, change only in cash,
 * never above the balance. Register payments go to the operator's open cash register;
 * online/marketplace payments settle the order without one. Refunds need payments:refund,
 * a reason and leave the register open at that moment.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (PIX key) is the tenant itself, not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly cash: CashService,
    private readonly audit: AuditService,
  ) {}

  private get userId(): string {
    const id = this.ctx.userId;
    if (!id) throw new ForbiddenError('Operação exige um usuário autenticado');
    return id;
  }

  async create(
    orderId: string,
    input: Omit<CreatePaymentInput, 'cardBrand' | 'authorizationCode' | 'externalRef'> & {
      cardBrand?: string | null;
      authorizationCode?: string | null;
      externalRef?: string | null;
    },
  ): Promise<OrderDetailDto> {
    const userId = this.userId;
    const sessionId = await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId } });
      if (!order) throw new NotFoundError('Pedido');
      if (order.status === 'CANCELED') throw new ValidationError('Este pedido foi cancelado');
      if (order.status === 'DELIVERED' && order.type !== 'DELIVERY') {
        throw new ValidationError('Esta conta já foi encerrada');
      }
      const summary = paymentSummaryOf(order.totalCents, order.paidCents);
      const check = preparePayment(summary.balanceCents, input);
      if (!check.ok) throw new ValidationError(check.message);

      let session = null;
      if (usesCashRegister(input.method)) {
        session = await this.cash.lockOpenSession(tx, userId);
        if (!session) throw new ValidationError('Abra o caixa para receber pagamentos');
      }
      await tx.payment.create({
        data: {
          orderId,
          method: input.method,
          ...check.payment,
          cashSessionId: session?.id ?? null,
          // The PIX txid is the order public code (8 alphanumeric, within the 25 of the BR Code).
          externalRef: input.method === 'PIX' ? order.publicCode : (input.externalRef ?? null),
          cardBrand: input.cardBrand ?? null,
          authorizationCode: input.authorizationCode ?? null,
          createdById: userId,
        },
      });
      const paidCents = order.paidCents + check.payment.amountCents;
      await this.orders.updateVersioned(tx, orderId, input.expectedVersion, {
        paidCents,
        paymentStatus: paymentSummaryOf(order.totalCents, paidCents).status,
      });
      return session?.id ?? null;
    });
    if (sessionId) this.cash.notify(sessionId);
    return this.orders.publish(orderId);
  }

  async refund(
    orderId: string,
    paymentId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<OrderDetailDto> {
    const userId = this.userId;
    const sessions = await this.db.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, orderId } });
      if (!payment) throw new NotFoundError('Pagamento');
      if (payment.status !== 'CONFIRMED')
        throw new ValidationError('Este pagamento já foi estornado');
      const order = await tx.order.findFirst({ where: { id: orderId } });
      if (!order) throw new NotFoundError('Pedido');
      if (
        isFinalStatus(order.status) &&
        !(order.type === 'DELIVERY' && order.status === 'DELIVERED')
      ) {
        throw new ValidationError('Conta encerrada não pode ter pagamento estornado');
      }

      // The refund leaves the register open now (a closed register never changes).
      let refundSession = null;
      if (usesCashRegister(payment.method)) {
        refundSession = await this.cash.lockOpenSession(tx, userId);
        if (!refundSession) throw new ValidationError('Abra o seu caixa para fazer o estorno');
        if (payment.method === 'CASH') {
          const totals = await this.cash.totals(tx, refundSession.id);
          const error = cashRefundError(totals.expectedCashCents, payment.amountCents);
          if (error) throw new ValidationError(error);
        }
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          refundedById: userId,
          refundReason: input.reason,
          refundSessionId: refundSession?.id ?? null,
        },
      });
      const paidCents = order.paidCents - payment.amountCents;
      await this.orders.updateVersioned(tx, orderId, input.expectedVersion, {
        paidCents,
        paymentStatus: paymentSummaryOf(order.totalCents, paidCents).status,
      });
      await this.audit.log(
        {
          action: AuditAction.PAYMENT_REFUNDED,
          entity: 'Order',
          entityId: orderId,
          reason: input.reason,
          before: {
            number: order.number,
            payment: {
              id: payment.id,
              method: payment.method,
              amountCents: payment.amountCents,
              cashSessionId: payment.cashSessionId,
            },
          },
          after: { refundSessionId: refundSession?.id ?? null, paidCents },
        },
        tx,
      );
      return [payment.cashSessionId, refundSession?.id].filter(Boolean) as string[];
    });
    for (const id of new Set(sessions)) this.cash.notify(id);
    return this.orders.publish(orderId);
  }

  /** Static PIX QR Code for the balance (or one share of it). */
  async pixCharge(orderId: string, amountCents?: number): Promise<PixChargeDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { pixKeyType: true, pixKey: true, pixMerchantName: true, pixMerchantCity: true },
    });
    if (!store?.pixKeyType || !store.pixKey || !store.pixMerchantName || !store.pixMerchantCity) {
      throw new ValidationError('Cadastre a chave PIX na tela Empresa para gerar o QR Code');
    }
    const order = await this.db.order.findFirst({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Pedido');
    const { balanceCents } = paymentSummaryOf(order.totalCents, order.paidCents);
    if (balanceCents === 0) throw new ValidationError('Esta conta já está paga');
    const amount = amountCents ?? balanceCents;
    if (amount > balanceCents) {
      throw new ValidationError(`Valor acima do saldo da conta (${formatBRL(balanceCents)})`);
    }
    return {
      brCode: buildPixBrCode({
        key: store.pixKey,
        merchantName: store.pixMerchantName,
        merchantCity: store.pixMerchantCity,
        amountCents: amount,
        txid: order.publicCode,
      }),
      amountCents: amount,
      txid: order.publicCode,
      keyType: store.pixKeyType as PixKeyType,
      key: store.pixKey,
      merchantName: store.pixMerchantName,
      merchantCity: store.pixMerchantCity,
    };
  }
}
