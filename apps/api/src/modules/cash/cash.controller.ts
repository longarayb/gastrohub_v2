import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  cashMovementSchema,
  cashSessionListQuerySchema,
  closeCashSessionSchema,
  createPaymentSchema,
  openCashSessionSchema,
  pixChargeQuerySchema,
  refundPaymentSchema,
  reopenCashSessionSchema,
} from '@app/shared';
import type { z } from 'zod';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { CashService } from './cash.service.js';
import { PaymentsService } from './payments.service.js';

@ApiTags('cash')
@ApiBearerAuth()
@Controller('cash-sessions')
export class CashSessionsController {
  constructor(private readonly cash: CashService) {}

  @Get('current')
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({
    summary: 'Caixa aberto do usuário (no fechamento cego, sem os valores esperados)',
  })
  current() {
    return this.cash.current();
  }

  @Get()
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({ summary: 'Caixas do dia (gerente vê todos; operador, só os seus)' })
  @ApiZodQuery(cashSessionListQuerySchema)
  list(@ZQuery(cashSessionListQuerySchema) query: z.output<typeof cashSessionListQuerySchema>) {
    return this.cash.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.CASH_OPERATE)
  get(@Param('id') id: string) {
    return this.cash.get(id);
  }

  @Post()
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({ summary: 'Abre o caixa do usuário com o troco inicial' })
  @ApiZodBody(openCashSessionSchema)
  open(@ZBody(openCashSessionSchema) body: z.output<typeof openCashSessionSchema>) {
    return this.cash.open(body);
  }

  @Post('current/movements')
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({
    summary: 'Sangria ou suprimento no caixa aberto do usuário (motivo obrigatório)',
  })
  @ApiZodBody(cashMovementSchema)
  movement(@ZBody(cashMovementSchema) body: z.output<typeof cashMovementSchema>) {
    return this.cash.addMovement(body);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({
    summary: 'Fecha o caixa com a contagem por forma de pagamento (outro operador: cash:manage)',
  })
  @ApiZodBody(closeCashSessionSchema)
  close(
    @Param('id') id: string,
    @ZBody(closeCashSessionSchema) body: z.output<typeof closeCashSessionSchema>,
  ) {
    return this.cash.close(id, body);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions(Permission.CASH_MANAGE)
  @ApiOperation({ summary: 'Reabre um caixa fechado (motivo e auditoria)' })
  @ApiZodBody(reopenCashSessionSchema)
  reopen(
    @Param('id') id: string,
    @ZBody(reopenCashSessionSchema) body: z.output<typeof reopenCashSessionSchema>,
  ) {
    return this.cash.reopen(id, body);
  }
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders/:orderId')
export class OrderPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments')
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({
    summary: 'Registra um pagamento (dinheiro com troco; online/marketplace sem caixa aberto)',
  })
  @ApiZodBody(createPaymentSchema)
  create(
    @Param('orderId') orderId: string,
    @ZBody(createPaymentSchema) body: z.output<typeof createPaymentSchema>,
  ) {
    return this.payments.create(orderId, body);
  }

  @Post('payments/:paymentId/refund')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_REFUND)
  @ApiOperation({ summary: 'Estorna um pagamento (sai do caixa aberto de quem estorna)' })
  @ApiZodBody(refundPaymentSchema)
  refund(
    @Param('orderId') orderId: string,
    @Param('paymentId') paymentId: string,
    @ZBody(refundPaymentSchema) body: z.output<typeof refundPaymentSchema>,
  ) {
    return this.payments.refund(orderId, paymentId, body);
  }

  @Get('pix')
  @RequirePermissions(Permission.ORDERS_READ)
  @ApiOperation({ summary: 'QR Code PIX estático do saldo (ou de uma parte, amountCents)' })
  @ApiZodQuery(pixChargeQuerySchema)
  pix(
    @Param('orderId') orderId: string,
    @ZQuery(pixChargeQuerySchema) query: z.output<typeof pixChargeQuerySchema>,
  ) {
    return this.payments.pixCharge(orderId, query.amountCents);
  }
}
