import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CashModule } from '../cash/cash.module.js';
import { DeliveryModule } from '../delivery/delivery.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PrintAgentsService } from './print-agents.service.js';
import { PrintDocumentsService } from './print-documents.service.js';
import { PrintJobsService } from './print-jobs.service.js';
import { PrintQueueModule } from './print-queue.module.js';
import { PrintersService } from './printers.service.js';
import { PrintAgentController, PrintingController } from './printing.controller.js';

/** Printing: agents, printers, queue and documents (docs/DECISOES.md D035–D037). */
@Module({
  imports: [AuthModule, OrdersModule, CashModule, DeliveryModule, PrintQueueModule],
  controllers: [PrintingController, PrintAgentController],
  providers: [PrintAgentsService, PrintersService, PrintJobsService, PrintDocumentsService],
})
export class PrintingModule {}
