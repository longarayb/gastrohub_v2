import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { CouponsService } from './coupons.service.js';
import { CustomersService } from './customers.service.js';
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

@Module({
  imports: [MenuModule],
  controllers: [
    OrdersController,
    TablesController,
    CustomersController,
    CouriersController,
    CouponsController,
  ],
  providers: [OrdersService, OrderPricingService, TablesService, CustomersService, CouponsService],
  exports: [OrdersService],
})
export class OrdersModule {}
