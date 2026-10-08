import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module.js';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CourierAppService } from './courier-app.service.js';
import { CouriersService } from './couriers.service.js';
import { DeliveryAreasService } from './delivery-areas.service.js';
import { CourierAppController, DeliveryController } from './delivery.controller.js';
import { DeliveryReportService } from './delivery-report.service.js';
import { SettlementsService } from './settlements.service.js';

/** Delivery areas, couriers, courier app, settlements and report (docs/DECISOES.md D029–D031). */
@Module({
  imports: [MenuModule, OrdersModule, CashModule],
  controllers: [DeliveryController, CourierAppController],
  providers: [
    DeliveryAreasService,
    CouriersService,
    CourierAppService,
    SettlementsService,
    DeliveryReportService,
  ],
  // Printing the courier settlement (printing module).
  exports: [SettlementsService],
})
export class DeliveryModule {}
