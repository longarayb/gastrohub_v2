import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Permission,
  type PrintAgentSessionDto,
  printAckSchema,
  printAgentHeartbeatSchema,
  printAgentPairSchema,
  printAgentSchema,
  printAgentSessionSchema,
  printHeldDecisionSchema,
  printJobsQuerySchema,
  printLeaseSchema,
  printOrderSchema,
  printPreBillSchema,
  printSettingsSchema,
  printTargetSchema,
  printerSchema,
  sectorPrintersSchema,
} from '@app/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { Public, RequirePermissions } from '../auth/auth.decorators.js';
import { PrintAgentsService } from './print-agents.service.js';
import { PrintDocumentsService } from './print-documents.service.js';
import { PrintJobsService } from './print-jobs.service.js';
import { PrintersService } from './printers.service.js';

/** Panel: agents, printers, settings, queue and documents (docs/DECISOES.md D035–D037). */
@ApiTags('printing')
@ApiBearerAuth()
@Controller('printing')
export class PrintingController {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly printers: PrintersService,
    private readonly jobs: PrintJobsService,
    private readonly documents: PrintDocumentsService,
  ) {}

  @Get('status')
  @RequirePermissions(Permission.PRINT)
  @ApiOperation({ summary: 'Computadores, impressoras, configuração e alertas da impressão' })
  status() {
    return this.printers.status();
  }

  // ---- Agents ----

  @Post('agents')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiOperation({ summary: 'Cadastra um computador que imprime e devolve o código de vínculo' })
  @ApiZodBody(printAgentSchema)
  createAgent(@ZBody(printAgentSchema) body: z.output<typeof printAgentSchema>) {
    return this.agents.create(body);
  }

  @Patch('agents/:id')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiZodBody(printAgentSchema)
  renameAgent(
    @Param('id') id: string,
    @ZBody(printAgentSchema) body: z.output<typeof printAgentSchema>,
  ) {
    return this.agents.rename(id, body);
  }

  @Post('agents/:id/pairing-code')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiOperation({ summary: 'Gera um novo código de vínculo (válido por 10 minutos)' })
  pairingCode(@Param('id') id: string) {
    return this.agents.pairingCode(id);
  }

  @Post('agents/:id/revoke')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiOperation({ summary: 'Desvincula o computador (perde o acesso na hora)' })
  revokeAgent(@Param('id') id: string) {
    return this.agents.revoke(id);
  }

  // ---- Printers and settings ----

  @Post('printers')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiZodBody(printerSchema)
  createPrinter(@ZBody(printerSchema) body: z.output<typeof printerSchema>) {
    return this.printers.create(body);
  }

  @Patch('printers/:id')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiZodBody(printerSchema)
  updatePrinter(
    @Param('id') id: string,
    @ZBody(printerSchema) body: z.output<typeof printerSchema>,
  ) {
    return this.printers.update(id, body);
  }

  @Delete('printers/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  async removePrinter(@Param('id') id: string): Promise<void> {
    await this.printers.remove(id);
  }

  @Post('printers/:id/test')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiOperation({ summary: 'Imprime a página de teste (acentos, modelo e largura do papel)' })
  testPrinter(@Param('id') id: string) {
    return this.printers.test(id);
  }

  @Put('settings')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiZodBody(printSettingsSchema)
  updateSettings(@ZBody(printSettingsSchema) body: z.output<typeof printSettingsSchema>) {
    return this.printers.updateSettings(body);
  }

  @Put('sectors')
  @RequirePermissions(Permission.PRINTERS_MANAGE)
  @ApiOperation({ summary: 'Impressora e número de vias de cada setor de produção' })
  @ApiZodBody(sectorPrintersSchema)
  updateSectors(@ZBody(sectorPrintersSchema) body: z.output<typeof sectorPrintersSchema>) {
    return this.printers.updateSectors(body);
  }

  // ---- Queue ----

  @Get('jobs')
  @RequirePermissions(Permission.PRINT)
  @ApiZodQuery(printJobsQuerySchema)
  listJobs(@ZQuery(printJobsQuerySchema) query: z.output<typeof printJobsQuerySchema>) {
    return this.jobs.list(query);
  }

  @Get('jobs/:id/preview')
  @RequirePermissions(Permission.PRINT)
  preview(@Param('id') id: string) {
    return this.jobs.preview(id);
  }

  @Post('jobs/:id/reprint')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT)
  @ApiOperation({ summary: 'Imprime de novo, marcado como 2ª via' })
  @ApiZodBody(printTargetSchema)
  reprint(
    @Param('id') id: string,
    @ZBody(printTargetSchema) body: z.output<typeof printTargetSchema>,
  ) {
    return this.jobs.reprint(id, body.printerId);
  }

  @Post('jobs/:id/held')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT)
  @ApiOperation({ summary: 'Impressão retida (antiga): imprimir agora ou descartar' })
  @ApiZodBody(printHeldDecisionSchema)
  decideHeld(
    @Param('id') id: string,
    @ZBody(printHeldDecisionSchema) body: z.output<typeof printHeldDecisionSchema>,
  ) {
    return this.jobs.decideHeld(id, body.action);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT)
  retry(@Param('id') id: string) {
    return this.jobs.retry(id);
  }

  // ---- Documents ----

  @Post('orders/:id')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT, Permission.ORDERS_READ)
  @ApiOperation({ summary: 'Imprime a via de entrega ou a 2ª via das comandas de um pedido' })
  @ApiZodBody(printOrderSchema)
  printOrder(
    @Param('id') id: string,
    @ZBody(printOrderSchema) body: z.output<typeof printOrderSchema>,
  ) {
    return this.documents.order(id, body);
  }

  @Post('pre-bill')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT, Permission.TABLES_OPERATE)
  @ApiZodBody(printPreBillSchema)
  preBill(@ZBody(printPreBillSchema) body: z.output<typeof printPreBillSchema>) {
    return this.documents.preBill(body);
  }

  @Post('cash-sessions/:id')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT, Permission.CASH_OPERATE)
  @ApiZodBody(printTargetSchema)
  cashClose(
    @Param('id') id: string,
    @ZBody(printTargetSchema) body: z.output<typeof printTargetSchema>,
  ) {
    return this.documents.cashClose(id, body.printerId);
  }

  @Post('settlements/:id')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT, Permission.CASH_OPERATE)
  @ApiZodBody(printTargetSchema)
  settlement(
    @Param('id') id: string,
    @ZBody(printTargetSchema) body: z.output<typeof printTargetSchema>,
  ) {
    return this.documents.settlement(id, body.printerId);
  }
}

/** The local print agent: pairing, session, heartbeat, lease and acknowledgement. */
@ApiTags('print-agent')
@Controller('print-agent')
export class PrintAgentController {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly jobs: PrintJobsService,
  ) {}

  @Public()
  @Post('pair')
  @HttpCode(200)
  // Per IP; per store and per code limits live in the service (same as the kitchen screens).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Vincula o computador com o código da unidade e o código de 6 dígitos' })
  @ApiZodBody(printAgentPairSchema)
  pair(
    @ZBody(printAgentPairSchema) body: z.output<typeof printAgentPairSchema>,
    @Req() req: Request,
  ): Promise<PrintAgentSessionDto> {
    return this.agents.pair(body, { ip: req.ip });
  }

  @Public()
  @Post('session')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Troca a credencial guardada no computador por um acesso curto' })
  @ApiZodBody(printAgentSessionSchema)
  session(
    @ZBody(printAgentSessionSchema) body: z.output<typeof printAgentSessionSchema>,
  ): Promise<PrintAgentSessionDto> {
    return this.agents.renew(body.token);
  }

  @Post('heartbeat')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT_AGENT)
  @ApiZodBody(printAgentHeartbeatSchema)
  heartbeat(@ZBody(printAgentHeartbeatSchema) body: z.output<typeof printAgentHeartbeatSchema>) {
    return this.agents.heartbeat(body);
  }

  @Post('lease')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT_AGENT)
  @ApiZodBody(printLeaseSchema)
  lease(@ZBody(printLeaseSchema) body: z.output<typeof printLeaseSchema>) {
    return this.jobs.lease(body.max);
  }

  @Post('jobs/:id/ack')
  @HttpCode(200)
  @RequirePermissions(Permission.PRINT_AGENT)
  @ApiZodBody(printAckSchema)
  ack(@Param('id') id: string, @ZBody(printAckSchema) body: z.output<typeof printAckSchema>) {
    return this.jobs.ack(id, body);
  }
}
