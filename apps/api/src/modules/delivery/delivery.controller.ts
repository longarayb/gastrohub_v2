import { Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  addNeighborhoodSchema,
  collectionSchema,
  courierDeliverSchema,
  courierPaySchema,
  courierPayoutSchema,
  courierUpdateSchema,
  deliveryAreaSchema,
  deliveryFailureSchema,
  deliveryQuoteSchema,
  deliveryReportQuerySchema,
  pauseAreaSchema,
  settlementSchema,
} from '@app/shared';
import { z } from 'zod';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { DeliveryPricingService } from '../orders/delivery-pricing.service.js';
import { CourierAppService } from './courier-app.service.js';
import { CouriersService } from './couriers.service.js';
import { DeliveryAreasService } from './delivery-areas.service.js';
import { DeliveryReportService } from './delivery-report.service.js';
import { SettlementsService } from './settlements.service.js';

const courierQuery = z.object({ courierId: z.string().min(1, 'Escolha o entregador') });
const optionalCourierQuery = z.object({ courierId: z.string().optional() });

@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly areas: DeliveryAreasService,
    private readonly pricing: DeliveryPricingService,
    private readonly couriers: CouriersService,
    private readonly app: CourierAppService,
    private readonly settlements: SettlementsService,
    private readonly reports: DeliveryReportService,
  ) {}

  // ---- Areas

  @Get('areas')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  listAreas() {
    return this.areas.list();
  }

  @Get('areas/unmatched')
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Bairros de pedidos e clientes recentes que nenhuma área cobre' })
  unmatched() {
    return this.areas.unmatched();
  }

  @Post('areas')
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiZodBody(deliveryAreaSchema)
  createArea(@ZBody(deliveryAreaSchema) body: z.output<typeof deliveryAreaSchema>) {
    return this.areas.create(body);
  }

  @Put('areas/:id')
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiZodBody(deliveryAreaSchema)
  updateArea(
    @Param('id') id: string,
    @ZBody(deliveryAreaSchema) body: z.output<typeof deliveryAreaSchema>,
  ) {
    return this.areas.update(id, body);
  }

  @Delete('areas/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  async removeArea(@Param('id') id: string) {
    await this.areas.remove(id);
  }

  @Post('areas/:id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Suspende a entrega na área (chuva, sem entregador...)' })
  @ApiZodBody(pauseAreaSchema)
  pauseArea(
    @Param('id') id: string,
    @ZBody(pauseAreaSchema) body: z.output<typeof pauseAreaSchema>,
  ) {
    return this.areas.pause(id, body);
  }

  @Post('areas/:id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  resumeArea(@Param('id') id: string) {
    return this.areas.resume(id);
  }

  @Post('areas/:id/neighborhoods')
  @HttpCode(200)
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Inclui um bairro (ou variação de nome) numa área' })
  @ApiZodBody(addNeighborhoodSchema)
  addNeighborhood(
    @Param('id') id: string,
    @ZBody(addNeighborhoodSchema) body: z.output<typeof addNeighborhoodSchema>,
  ) {
    return this.areas.addNeighborhood(id, body.name);
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_CREATE)
  @ApiOperation({ summary: 'Área, taxa, tempo e mínimo de entrega de um endereço' })
  @ApiZodBody(deliveryQuoteSchema)
  quote(@ZBody(deliveryQuoteSchema) body: z.output<typeof deliveryQuoteSchema>) {
    return this.pricing.quote(body);
  }

  // ---- Couriers

  @Get('couriers')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Entregadores com status, saldo e saída em aberto' })
  listCouriers() {
    return this.couriers.list();
  }

  @Put('couriers/:id')
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiZodBody(courierUpdateSchema)
  async updateCourier(
    @Param('id') id: string,
    @ZBody(courierUpdateSchema) body: z.output<typeof courierUpdateSchema>,
  ) {
    await this.couriers.update(id, body);
    return this.couriers.list();
  }

  @Get('couriers/:id/ledger')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  ledger(@Param('id') id: string) {
    return this.couriers.ledger(id);
  }

  @Post('couriers/:id/payouts')
  @HttpCode(200)
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({ summary: 'Paga o entregador pelo saldo (sangria auditada do caixa aberto)' })
  @ApiZodBody(courierPayoutSchema)
  payout(
    @Param('id') id: string,
    @ZBody(courierPayoutSchema) body: z.output<typeof courierPayoutSchema>,
  ) {
    return this.couriers.payout(id, body);
  }

  @Get('settings')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  paySettings() {
    return this.couriers.paySettings();
  }

  @Put('settings')
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Remuneração padrão: por entrega, % da taxa e diária' })
  @ApiZodBody(courierPaySchema)
  updatePaySettings(@ZBody(courierPaySchema) body: z.output<typeof courierPaySchema>) {
    return this.couriers.updatePaySettings(body);
  }

  @Post('runs/:id/return')
  @HttpCode(204)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Registra a volta do entregador (sem o app)' })
  async returnRun(@Param('id') id: string) {
    await this.app.returnRun(id);
  }

  // ---- Settlements and report

  @Get('settlements/preview')
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiZodQuery(courierQuery)
  preview(@ZQuery(courierQuery) query: z.output<typeof courierQuery>) {
    return this.settlements.preview(query.courierId);
  }

  @Post('settlements')
  @RequirePermissions(Permission.CASH_OPERATE)
  @ApiOperation({ summary: 'Acerto do entregador no caixa de quem acerta' })
  @ApiZodBody(settlementSchema)
  settle(@ZBody(settlementSchema) body: z.output<typeof settlementSchema>) {
    return this.settlements.settle(body);
  }

  @Get('settlements')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiZodQuery(optionalCourierQuery)
  settlementsList(@ZQuery(optionalCourierQuery) query: z.output<typeof optionalCourierQuery>) {
    return this.settlements.list(query);
  }

  @Get('report')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiZodQuery(deliveryReportQuerySchema)
  report(@ZQuery(deliveryReportQuerySchema) query: z.output<typeof deliveryReportQuerySchema>) {
    return this.reports.report(query);
  }
}

/** Courier app: only the signed-in courier's own open route (LGPD). */
@ApiTags('courier')
@ApiBearerAuth()
@Controller('courier')
export class CourierAppController {
  constructor(private readonly app: CourierAppService) {}

  @Get('me')
  @RequirePermissions(Permission.COURIER_APP)
  me() {
    return this.app.me();
  }

  @Post('stops/:id/deliver')
  @HttpCode(200)
  @RequirePermissions(Permission.COURIER_APP)
  @ApiZodBody(courierDeliverSchema)
  deliver(
    @Param('id') id: string,
    @ZBody(courierDeliverSchema) body: z.output<typeof courierDeliverSchema>,
  ) {
    return this.app.deliver(id, body.collection ?? null);
  }

  @Put('stops/:id/collection')
  @RequirePermissions(Permission.COURIER_APP)
  @ApiZodBody(collectionSchema)
  collection(
    @Param('id') id: string,
    @ZBody(collectionSchema) body: z.output<typeof collectionSchema>,
  ) {
    return this.app.setCollection(id, body);
  }

  @Post('stops/:id/fail')
  @HttpCode(200)
  @RequirePermissions(Permission.COURIER_APP)
  @ApiOperation({ summary: 'Não entregue: o pedido volta para a loja com o motivo' })
  @ApiZodBody(deliveryFailureSchema)
  fail(
    @Param('id') id: string,
    @ZBody(deliveryFailureSchema) body: z.output<typeof deliveryFailureSchema>,
  ) {
    return this.app.fail(id, { reason: body.reason, note: body.note ?? null });
  }

  @Post('return')
  @HttpCode(200)
  @RequirePermissions(Permission.COURIER_APP)
  returnOwn() {
    return this.app.returnOwn();
  }
}
