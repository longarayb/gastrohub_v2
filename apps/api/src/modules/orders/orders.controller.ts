import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  addItemsSchema,
  areaSchema,
  assignCourierSchema,
  cancelItemSchema,
  changeStatusSchema,
  changeTableSchema,
  courierSchema,
  couponSchema,
  createOrderSchema,
  customerAddressSchema,
  customerSchema,
  mergeSessionsSchema,
  moveItemsSchema,
  orderDiscountSchema,
  orderListQuerySchema,
  sendRoundSchema,
  serviceFeeSchema,
  splitSessionSchema,
  tableSchema,
  transferOrderSchema,
} from '@app/shared';
import { z } from 'zod';
import { ValidationError } from '../../core/errors/domain-error.js';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { CouponsService } from './coupons.service.js';
import { CustomersService } from './customers.service.js';
import { OrdersService } from './orders.service.js';
import { TablesService } from './tables.service.js';
import { TabsService } from './tabs.service.js';

const zVersionBody = z.object({ expectedVersion: z.number().int().min(0) });

function idempotencyKey(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new ValidationError('Idempotency-Key inválida (8 a 100 caracteres alfanuméricos)');
  }
  return value;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly tabs: TabsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ORDERS_READ)
  @ApiOperation({ summary: 'Lista pedidos (board=true: abertos + finalizados nas últimas 12 h)' })
  @ApiZodQuery(orderListQuerySchema)
  list(@ZQuery(orderListQuerySchema) query: z.output<typeof orderListQuerySchema>) {
    return this.orders.list(query);
  }

  @Post()
  @RequirePermissions(Permission.ORDERS_CREATE)
  @ApiOperation({ summary: 'Lança um pedido (balcão, delivery ou conta de mesa)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Evita pedidos duplicados' })
  @ApiZodBody(createOrderSchema)
  create(
    @ZBody(createOrderSchema) body: z.output<typeof createOrderSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.orders.create(body, { source: 'POS', idempotencyKey: idempotencyKey(key) });
  }

  @Get(':id')
  @RequirePermissions(Permission.ORDERS_READ)
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post(':id/items')
  @RequirePermissions(Permission.ORDERS_CREATE)
  @ApiOperation({ summary: 'Adiciona uma rodada de itens a uma conta de mesa' })
  @ApiZodBody(addItemsSchema)
  addItems(@Param('id') id: string, @ZBody(addItemsSchema) body: z.output<typeof addItemsSchema>) {
    return this.orders.addItems(id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_CREATE)
  @ApiOperation({ summary: 'Envia à cozinha os itens ainda não enviados' })
  @ApiZodBody(sendRoundSchema)
  send(@Param('id') id: string, @ZBody(sendRoundSchema) body: { expectedVersion: number }) {
    return this.orders.sendRound(id, body.expectedVersion);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(Permission.ORDERS_CREATE)
  @ApiOperation({ summary: 'Remove um item ainda não enviado à cozinha' })
  removeDraft(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Query('expectedVersion') expectedVersion: string,
  ) {
    const version = zVersionBody.parse({ expectedVersion: Number(expectedVersion) });
    return this.orders.removeDraftItem(id, itemId, version.expectedVersion);
  }

  @Post(':id/items/:itemId/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_UPDATE_STATUS)
  @ApiOperation({
    summary: 'Cancela um item já enviado (permissão orders:cancel, motivo e auditoria)',
  })
  @ApiZodBody(cancelItemSchema)
  cancelItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @ZBody(cancelItemSchema) body: z.output<typeof cancelItemSchema>,
  ) {
    return this.orders.cancelItem(id, itemId, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_UPDATE_STATUS)
  @ApiOperation({ summary: 'Muda o status (cancelar exige orders:cancel e motivo)' })
  @ApiZodBody(changeStatusSchema)
  changeStatus(
    @Param('id') id: string,
    @ZBody(changeStatusSchema) body: z.output<typeof changeStatusSchema>,
  ) {
    return this.orders.changeStatus(id, body);
  }

  @Post(':id/discount')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_DISCOUNT)
  @ApiZodBody(orderDiscountSchema)
  discount(
    @Param('id') id: string,
    @ZBody(orderDiscountSchema) body: z.output<typeof orderDiscountSchema>,
  ) {
    return this.orders.setOrderDiscount(id, body);
  }

  @Post(':id/service-fee')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_DISCOUNT)
  @ApiOperation({ summary: 'Retira ou devolve a taxa de serviço (auditado)' })
  @ApiZodBody(serviceFeeSchema)
  serviceFee(
    @Param('id') id: string,
    @ZBody(serviceFeeSchema) body: z.output<typeof serviceFeeSchema>,
  ) {
    return this.orders.setServiceFee(id, body);
  }

  @Post(':id/move-items')
  @HttpCode(200)
  @RequirePermissions(Permission.TABLES_OPERATE)
  @ApiOperation({
    summary: 'Move itens (ou parte da quantidade) para outra conta da mesa ou uma conta nova',
  })
  @ApiZodBody(moveItemsSchema)
  moveItems(
    @Param('id') id: string,
    @ZBody(moveItemsSchema) body: z.output<typeof moveItemsSchema>,
  ) {
    return this.tabs.moveItems(id, body);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions(Permission.TABLES_OPERATE)
  @ApiOperation({ summary: 'Transfere a conta para outra mesa' })
  @ApiZodBody(transferOrderSchema)
  transfer(
    @Param('id') id: string,
    @ZBody(transferOrderSchema) body: z.output<typeof transferOrderSchema>,
  ) {
    return this.tabs.transferOrder(id, body);
  }

  @Post(':id/courier')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_UPDATE_STATUS)
  @ApiZodBody(assignCourierSchema)
  courier(
    @Param('id') id: string,
    @ZBody(assignCourierSchema) body: z.output<typeof assignCourierSchema>,
  ) {
    return this.orders.assignCourier(id, body);
  }
}

@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
export class TablesController {
  constructor(
    private readonly tables: TablesService,
    private readonly tabs: TabsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ORDERS_READ)
  @ApiOperation({ summary: 'Mesas com a sessão aberta e as contas de cada uma' })
  list() {
    return this.tables.listTables();
  }

  @Post()
  @RequirePermissions(Permission.TABLES_MANAGE)
  @ApiZodBody(tableSchema)
  create(@ZBody(tableSchema) body: z.output<typeof tableSchema>) {
    return this.tables.createTable(body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TABLES_MANAGE)
  @ApiZodBody(tableSchema)
  update(@Param('id') id: string, @ZBody(tableSchema) body: z.output<typeof tableSchema>) {
    return this.tables.updateTable(id, body);
  }

  @Post('sessions/:sessionId/change-table')
  @HttpCode(200)
  @RequirePermissions(Permission.TABLES_OPERATE)
  @ApiOperation({ summary: 'Troca a mesa da sessão por outra livre' })
  @ApiZodBody(changeTableSchema)
  changeTable(
    @Param('sessionId') sessionId: string,
    @ZBody(changeTableSchema) body: z.output<typeof changeTableSchema>,
  ) {
    return this.tabs.changeTable(sessionId, body);
  }

  @Post('sessions/:sessionId/merge')
  @HttpCode(200)
  @RequirePermissions(Permission.TABLES_OPERATE)
  @ApiOperation({ summary: 'Junta outra mesa (sessão) a esta: mesas e contas' })
  @ApiZodBody(mergeSessionsSchema)
  merge(
    @Param('sessionId') sessionId: string,
    @ZBody(mergeSessionsSchema) body: z.output<typeof mergeSessionsSchema>,
  ) {
    return this.tabs.merge(sessionId, body);
  }

  @Post('sessions/:sessionId/split')
  @HttpCode(200)
  @RequirePermissions(Permission.TABLES_OPERATE)
  @ApiOperation({ summary: 'Separa uma mesa juntada, levando as contas escolhidas' })
  @ApiZodBody(splitSessionSchema)
  split(
    @Param('sessionId') sessionId: string,
    @ZBody(splitSessionSchema) body: z.output<typeof splitSessionSchema>,
  ) {
    return this.tabs.split(sessionId, body);
  }

  @Post('sessions/:sessionId/bill-request')
  @HttpCode(200)
  @RequirePermissions(Permission.ORDERS_READ)
  @ApiOperation({ summary: 'Marca a mesa como aguardando pagamento (pré-conta impressa)' })
  requestBill(@Param('sessionId') sessionId: string) {
    return this.tabs.requestBill(sessionId);
  }

  @Get('areas')
  @RequirePermissions(Permission.ORDERS_READ)
  areas() {
    return this.tables.listAreas();
  }

  @Post('areas')
  @RequirePermissions(Permission.TABLES_MANAGE)
  @ApiZodBody(areaSchema)
  createArea(@ZBody(areaSchema) body: { name: string }) {
    return this.tables.createArea(body.name);
  }

  @Delete('areas/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.TABLES_MANAGE)
  async removeArea(@Param('id') id: string) {
    await this.tables.removeArea(id);
  }
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Busca rápida por telefone (ou nome)' })
  search(@Query('q') q = '') {
    return q.trim().length >= 2 ? this.customers.search(q) : [];
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  @ApiZodBody(customerSchema)
  create(@ZBody(customerSchema) body: z.output<typeof customerSchema>) {
    return this.customers.create(body);
  }

  @Post(':id/addresses')
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  @ApiZodBody(customerAddressSchema)
  addAddress(
    @Param('id') id: string,
    @ZBody(customerAddressSchema) body: z.output<typeof customerAddressSchema>,
  ) {
    return this.customers.addAddress(id, body);
  }
}

@ApiTags('couriers')
@ApiBearerAuth()
@Controller('couriers')
export class CouriersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.ORDERS_READ)
  list() {
    return this.customers.listCouriers();
  }

  @Post()
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @ApiZodBody(courierSchema)
  create(@ZBody(courierSchema) body: z.output<typeof courierSchema>) {
    return this.customers.createCourier(body);
  }
}

@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermissions(Permission.ORDERS_DISCOUNT)
  list() {
    return this.coupons.list();
  }

  @Post()
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiZodBody(couponSchema)
  create(@ZBody(couponSchema) body: z.output<typeof couponSchema>) {
    return this.coupons.create(body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiZodBody(couponSchema)
  update(@Param('id') id: string, @ZBody(couponSchema) body: z.output<typeof couponSchema>) {
    return this.coupons.update(id, body);
  }
}
