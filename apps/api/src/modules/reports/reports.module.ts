import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { LossesReportService } from './losses-report.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Dashboard and reports (docs/DECISOES.md D038). */
@Module({
  imports: [MenuModule, OrdersModule],
  controllers: [ReportsController],
  providers: [ReportsService, LossesReportService],
})
export class ReportsModule {}
