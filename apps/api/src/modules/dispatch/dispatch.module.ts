import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { DispatchBoardService } from './dispatch-board.service.js';
import { DispatchController } from './dispatch.controller.js';
import { LiveEtaService } from './live-eta.service.js';
import { OrderLocationService } from './order-location.service.js';
import { PositionsService } from './positions.service.js';
import { RoutePlannerService } from './route-planner.service.js';
import { SimulationService } from './simulation.service.js';
import { TrackingService } from './tracking.service.js';

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
    LiveEtaService,
    TrackingService,
  ],
  // The courier app (delivery module) sends positions and shows the route.
  exports: [
    PositionsService,
    OrderLocationService,
    TrackingService,
    RoutePlannerService,
    LiveEtaService,
  ],
})
export class DispatchModule {}
