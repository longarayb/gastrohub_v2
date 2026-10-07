import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DigitalMenuAdminService } from './digital-menu-admin.service.js';
import {
  DigitalMenuAdminController,
  PublicDirectoryController,
  PublicMenuController,
} from './digital-menu.controller.js';
import { MenuRevalidationInterceptor, MenuRevalidationService } from './menu-revalidation.js';
import { PublicMenuService } from './public-menu.service.js';
import { PublicStoreGuard } from './public-store.guard.js';

/** Digital menu: public menu, orders and tracking; settings in the panel (D032–D034). */
@Module({
  imports: [MenuModule, OrdersModule],
  controllers: [PublicMenuController, PublicDirectoryController, DigitalMenuAdminController],
  providers: [
    PublicMenuService,
    DigitalMenuAdminService,
    PublicStoreGuard,
    MenuRevalidationService,
    { provide: APP_INTERCEPTOR, useClass: MenuRevalidationInterceptor },
  ],
})
export class DigitalMenuModule {}
