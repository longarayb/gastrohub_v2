import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { CouponsService } from './coupons.service.js';
import { CustomersService } from './customers.service.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DispatchService } from './dispatch.service.js';
import { OrderPricingService } from './order-pricing.service.js';
import {
  CouponsController,
  CouriersController,
  CustomersController,
  OrdersController,
  TablesController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TablesService } from './tables.service.js';
import { ProductionService } from './production.service.js';
import { TabsService } from './tabs.service.js';

@Module({
  imports: [MenuModule],
  controllers: [
    OrdersController,
    TablesController,
    CustomersController,
    CouriersController,
    CouponsController,
  ],
  providers: [
    OrdersService,
    OrderPricingService,
    TablesService,
    TabsService,
    ProductionService,
    CustomersService,
    CouponsService,
    DeliveryPricingService,
    DispatchService,
  ],
  exports: [OrdersService, ProductionService, DeliveryPricingService, DispatchService],
})
export class OrdersModule {}
