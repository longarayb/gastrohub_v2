import { Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type KdsDeviceSessionDto,
  Permission,
  kdsBoardQuerySchema,
  kdsDeviceSchema,
  kdsDispatchSchema,
  kdsPairSchema,
  kdsServeSchema,
  kdsTasksSchema,
} from '@app/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { z } from 'zod';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { Public, RequirePermissions } from '../auth/auth.decorators.js';
import { type DeviceCredential, KdsDevicesService } from './kds-devices.service.js';
import { KdsService } from './kds.service.js';

export const DEVICE_COOKIE = 'app_device';

@ApiTags('kds')
@ApiBearerAuth()
@Controller('kds')
export class KdsController {
  constructor(private readonly kds: KdsService) {}

  @Get('sectors')
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Setores que esta tela pode mostrar' })
  sectors() {
    return this.kds.sectors();
  }

  @Get('board')
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Tickets (rodada × setor) em aberto e os prontos recentes' })
  @ApiZodQuery(kdsBoardQuerySchema)
  board(@ZQuery(kdsBoardQuerySchema) query: z.output<typeof kdsBoardQuerySchema>) {
    return this.kds.board(query.sectors);
  }

  @Get('expedition')
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Expedição: pedidos com o progresso de cada setor' })
  expedition() {
    return this.kds.expedition();
  }

  @Get('products')
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Produtos dos setores da tela (para marcar "Acabou")' })
  @ApiZodQuery(kdsBoardQuerySchema)
  products(@ZQuery(kdsBoardQuerySchema) query: z.output<typeof kdsBoardQuerySchema>) {
    return this.kds.products(query.sectors);
  }

  @Post('tasks/start')
  @HttpCode(204)
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Inicia o preparo de itens (um item ou o ticket inteiro)' })
  @ApiZodBody(kdsTasksSchema)
  async start(@ZBody(kdsTasksSchema) body: z.output<typeof kdsTasksSchema>) {
    await this.kds.start(body.taskIds);
  }

  @Post('tasks/ready')
  @HttpCode(204)
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Marca itens como prontos (o pedido acompanha sozinho)' })
  @ApiZodBody(kdsTasksSchema)
  async ready(@ZBody(kdsTasksSchema) body: z.output<typeof kdsTasksSchema>) {
    await this.kds.ready(body.taskIds);
  }

  @Post('tasks/:id/recall')
  @HttpCode(204)
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Desfaz um "pronto" marcado por engano (auditado)' })
  async recall(@Param('id') id: string) {
    await this.kds.recall(id);
  }

  @Post('orders/:id/serve')
  @HttpCode(204)
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Expedição: rodada entregue (mesa e balcão; status não muda)' })
  @ApiZodBody(kdsServeSchema)
  async serve(
    @Param('id') id: string,
    @ZBody(kdsServeSchema) body: z.output<typeof kdsServeSchema>,
  ) {
    await this.kds.serve(id, body.roundIds);
  }

  @Post('orders/:id/dispatch')
  @HttpCode(204)
  @RequirePermissions(Permission.KDS_OPERATE)
  @ApiOperation({ summary: 'Expedição: delivery sai com o entregador escolhido' })
  @ApiZodBody(kdsDispatchSchema)
  async dispatch(
    @Param('id') id: string,
    @ZBody(kdsDispatchSchema) body: z.output<typeof kdsDispatchSchema>,
  ) {
    await this.kds.dispatch(id, body);
  }
}

@ApiTags('kds')
@ApiBearerAuth()
@Controller('kds/devices')
export class KdsDevicesController {
  constructor(private readonly devices: KdsDevicesService) {}

  @Get()
  @RequirePermissions(Permission.STORE_MANAGE)
  list() {
    return this.devices.list();
  }

  @Post()
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Cria uma tela de cozinha e devolve o código de vínculo (6 dígitos)' })
  @ApiZodBody(kdsDeviceSchema)
  create(@ZBody(kdsDeviceSchema) body: z.output<typeof kdsDeviceSchema>) {
    return this.devices.create(body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiZodBody(kdsDeviceSchema)
  update(@Param('id') id: string, @ZBody(kdsDeviceSchema) body: z.output<typeof kdsDeviceSchema>) {
    return this.devices.update(id, body);
  }

  @Post(':id/pairing-code')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Gera um novo código de vínculo (válido por 10 minutos)' })
  pairingCode(@Param('id') id: string) {
    return this.devices.pairingCode(id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Desvincula a tela (perde o acesso na hora)' })
  revoke(@Param('id') id: string) {
    return this.devices.revoke(id);
  }
}

/** Tablet side: pairing with store + code, session renewal with the device cookie. */
@ApiTags('kds')
@Controller('kds-device')
export class KdsDeviceAuthController {
  constructor(
    private readonly devices: KdsDevicesService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('pair')
  @HttpCode(200)
  // Per IP; per store and per code limits live in the service.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Vincula esta tela com o código da unidade e o código de 6 dígitos' })
  @ApiZodBody(kdsPairSchema)
  async pair(
    @ZBody(kdsPairSchema) body: z.output<typeof kdsPairSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<KdsDeviceSessionDto> {
    const { session, credential } = await this.devices.pair(body, { ip: req.ip });
    return this.respond(res, session, credential);
  }

  @Public()
  @Post('session')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renova o acesso da tela vinculada (cookie do dispositivo)' })
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<KdsDeviceSessionDto> {
    try {
      const { session, credential } = await this.devices.renew(readCookie(req));
      return this.respond(res, session, credential);
    } catch (error) {
      res.clearCookie(DEVICE_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Public()
  @Post('unpair')
  @HttpCode(204)
  async unpair(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.devices.unpair(readCookie(req));
    res.clearCookie(DEVICE_COOKIE, this.cookieOptions());
  }

  private respond(
    res: Response,
    session: KdsDeviceSessionDto,
    credential: DeviceCredential,
  ): KdsDeviceSessionDto {
    res.cookie(DEVICE_COOKIE, credential.token, {
      ...this.cookieOptions(),
      expires: credential.expiresAt,
    });
    return session;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api/kds-device',
    };
  }
}

function readCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[DEVICE_COOKIE];
}
