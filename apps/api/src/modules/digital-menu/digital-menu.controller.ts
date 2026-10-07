import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  blockedPhoneSchema,
  digitalMenuSettingsSchema,
  publicCartSchema,
  publicOrderSchema,
} from '@app/shared';
import type { z } from 'zod';
import { ValidationError } from '../../core/errors/domain-error.js';
import {
  MAX_UPLOAD_BYTES,
  type UploadedImage,
  assertImage,
} from '../../core/storage/image.service.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { Public, RequirePermissions } from '../auth/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { DigitalMenuAdminService } from './digital-menu-admin.service.js';
import { PublicMenuService } from './public-menu.service.js';
import { PublicStoreGuard } from './public-store.guard.js';

function idempotencyKey(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new ValidationError('Idempotency-Key inválida (8 a 100 caracteres alfanuméricos)');
  }
  return value;
}

/** Public digital menu of a restaurant (no login; the slug selects the tenant). */
@ApiTags('public')
@Public()
@UseGuards(PublicStoreGuard)
@Controller('public/:slug')
export class PublicMenuController {
  constructor(private readonly menu: PublicMenuService) {}

  @Get()
  @ApiOperation({ summary: 'Restaurante: marca, horários, aberto/fechado, aviso de privacidade' })
  store() {
    return this.menu.store();
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Cardápio do canal cardápio digital' })
  catalog() {
    return this.menu.catalog();
  }

  @Post('cart')
  @HttpCode(200)
  @ApiOperation({ summary: 'Prévia do carrinho calculada pelo servidor (cupom, entrega, mínimo)' })
  @ApiZodBody(publicCartSchema)
  cart(@ZBody(publicCartSchema) body: z.output<typeof publicCartSchema>) {
    return this.menu.preview(body);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Faz o pedido (pagamento na entrega ou na retirada)' })
  @ApiZodBody(publicOrderSchema)
  order(
    @ZBody(publicOrderSchema) body: z.output<typeof publicOrderSchema>,
    @Ip() ip: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.menu.create(body, { ip, idempotencyKey: idempotencyKey(key) });
  }

  @Get('orders/:token')
  @ApiOperation({ summary: 'Acompanhamento do pedido (link não adivinhável)' })
  track(@Param('token') token: string) {
    return this.menu.track(token);
  }

  @Post('orders/:token/pix-reported')
  @HttpCode(200)
  @ApiOperation({ summary: '"Já paguei": PIX informado pelo cliente, a conferir pelo caixa' })
  pixReported(@Param('token') token: string) {
    return this.menu.reportPix(token);
  }
}

/** Digital menu settings and blocked phones (panel). */
@ApiTags('digital-menu')
@ApiBearerAuth()
@Controller('digital-menu')
export class DigitalMenuAdminController {
  constructor(private readonly admin: DigitalMenuAdminService) {}

  @Get('settings')
  @RequirePermissions(Permission.STORE_MANAGE)
  settings() {
    return this.admin.settings();
  }

  @Put('settings')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiZodBody(digitalMenuSettingsSchema)
  updateSettings(
    @ZBody(digitalMenuSettingsSchema) body: z.output<typeof digitalMenuSettingsSchema>,
  ) {
    return this.admin.updateSettings(body);
  }

  @Post('cover')
  @RequirePermissions(Permission.STORE_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Envia a foto de capa do cardápio digital' })
  uploadCover(@UploadedFile() file: UploadedImage | undefined) {
    assertImage(file);
    return this.admin.updateCover(file);
  }

  @Delete('cover')
  @RequirePermissions(Permission.STORE_MANAGE)
  removeCover() {
    return this.admin.removeCover();
  }

  @Get('blocked-phones')
  @RequirePermissions(Permission.STORE_MANAGE)
  blockedPhones() {
    return this.admin.blockedPhones();
  }

  @Post('blocked-phones')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiZodBody(blockedPhoneSchema)
  block(@ZBody(blockedPhoneSchema) body: z.output<typeof blockedPhoneSchema>) {
    return this.admin.blockPhone(body);
  }

  @Delete('blocked-phones/:id')
  @RequirePermissions(Permission.STORE_MANAGE)
  unblock(@Param('id') id: string) {
    return this.admin.unblockPhone(id);
  }
}

/** Restaurants with a public menu, for the menu app sitemap (slug and last change only). */
@ApiTags('public')
@Public()
@Controller('public-directory')
export class PublicDirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const stores = await this.prisma.store.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
      take: 5000,
    });
    return stores.map((s) => ({ slug: s.slug, updatedAt: s.updatedAt.toISOString() }));
  }
}
