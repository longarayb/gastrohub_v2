import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { KdsController, KdsDeviceAuthController, KdsDevicesController } from './kds.controller.js';
import { KdsDevicesService } from './kds-devices.service.js';
import { KdsService } from './kds.service.js';

/** Kitchen display and KDS devices (docs/DECISOES.md D027–D028). */
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [KdsController, KdsDevicesController, KdsDeviceAuthController],
  providers: [KdsService, KdsDevicesService],
})
export class KdsModule {}
