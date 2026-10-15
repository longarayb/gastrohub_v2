import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { DispatchBoardService } from './dispatch-board.service.js';
import { DispatchController } from './dispatch.controller.js';
import { OrderLocationService } from './order-location.service.js';
import { PositionsService } from './positions.service.js';
import { RoutePlannerService } from './route-planner.service.js';
import { SimulationService } from './simulation.service.js';

/** Dispatch map, routes, courier positions and the simulated courier (docs/DECISOES.md D048). */
@Module({
  imports: [OrdersModule],
  controllers: [DispatchController],
  providers: [
    DispatchBoardService,
    OrderLocationService,
    RoutePlannerService,
    PositionsService,
    SimulationService,
  ],
  exports: [PositionsService, OrderLocationService],
})
export class DispatchModule {}
