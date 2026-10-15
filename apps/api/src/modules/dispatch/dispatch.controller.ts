import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  dispatchSchema,
  orderLocationSchema,
  routeSuggestionSchema,
  simulationSchema,
} from '@app/shared';
import { z } from 'zod';
import { AllowedInDemo } from '../../core/demo/demo-mode.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { RequiresModule } from '../platform/billing.decorators.js';
import { DispatchBoardService } from './dispatch-board.service.js';
import { OrderLocationService } from './order-location.service.js';
import { RoutePlannerService } from './route-planner.service.js';
import { SimulationService } from './simulation.service.js';

/** Dispatch screen with the map (docs/DECISOES.md D048). */
@ApiTags('dispatch')
@ApiBearerAuth()
@RequiresModule('DELIVERY')
@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly board: DispatchBoardService,
    private readonly planner: RoutePlannerService,
    private readonly locations: OrderLocationService,
    private readonly simulation: SimulationService,
  ) {}

  @Get('board')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Pedidos a despachar, entregadores e saídas abertas com a rota' })
  get() {
    return this.board.board();
  }

  @Post('routes/suggest')
  @HttpCode(200)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Ordem sugerida (ou mantida) das paradas, trechos e chegada prevista' })
  @ApiZodBody(routeSuggestionSchema)
  suggest(@ZBody(routeSuggestionSchema) body: z.output<typeof routeSuggestionSchema>) {
    return this.planner.suggest(body);
  }

  @Post('runs')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Despacha os pedidos na ordem informada e calcula a rota da saída' })
  @ApiZodBody(dispatchSchema)
  dispatch(@ZBody(dispatchSchema) body: z.output<typeof dispatchSchema>) {
    return this.board.dispatch(body);
  }

  @Patch('orders/:id/location')
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Corrige o ponto de entrega (pino arrastado no mapa)' })
  @ApiZodBody(orderLocationSchema)
  locate(
    @Param('id') id: string,
    @ZBody(orderLocationSchema) body: z.output<typeof orderLocationSchema>,
  ) {
    return this.locations.correct(id, body);
  }

  @Post('runs/:id/simulate')
  @HttpCode(204)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Entregador simulado percorre a rota (desenvolvimento e demonstração)' })
  @ApiZodBody(simulationSchema)
  async simulate(
    @Param('id') id: string,
    @ZBody(simulationSchema) body: z.output<typeof simulationSchema>,
  ) {
    await this.simulation.start(id, body.speed);
  }

  // Stopping a simulation is part of trying the dispatch (D045).
  @AllowedInDemo()
  @Delete('runs/:id/simulate')
  @HttpCode(204)
  @RequirePermissions(Permission.DELIVERY_OPERATE)
  @ApiOperation({ summary: 'Para o entregador simulado' })
  stopSimulation(@Param('id') id: string) {
    this.simulation.stop(id);
  }
}
