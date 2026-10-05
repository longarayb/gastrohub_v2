import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CashSessionsController, OrderPaymentsController } from './cash.controller.js';
import { CashService } from './cash.service.js';
import { PaymentsService } from './payments.service.js';

/** Cash register and payments (docs/DECISOES.md D023–D024). */
@Module({
  imports: [MenuModule, OrdersModule],
  controllers: [CashSessionsController, OrderPaymentsController],
  providers: [CashService, PaymentsService],
})
export class CashModule {}
