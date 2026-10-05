import { Controller, Get, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type BusinessHoursInput,
  type CreateStoreInput,
  Permission,
  type PixSettingsDto,
  type StoreSettingsInput,
  type UpdateStoreInput,
  businessHoursSchema,
  createStoreSchema,
  pixSettingsSchema,
  storeSettingsSchema,
  updateStoreSchema,
} from '@app/shared';
import {
  MAX_UPLOAD_BYTES,
  type UploadedImage,
  assertImage,
} from '../../core/storage/image.service.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { StoresService } from './stores.service.js';

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get('current')
  @ApiOperation({ summary: 'Dados da unidade ativa' })
  getCurrent() {
    return this.stores.getCurrent();
  }

  @Patch('current')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Atualiza dados cadastrais e endereço da unidade' })
  @ApiZodBody(updateStoreSchema)
  update(@ZBody(updateStoreSchema) body: UpdateStoreInput & { cnpj: string; phone: string }) {
    return this.stores.update(body);
  }

  @Patch('current/settings')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Atualiza configurações operacionais (taxa de serviço, KDS etc.)' })
  @ApiZodBody(storeSettingsSchema)
  updateSettings(@ZBody(storeSettingsSchema) body: StoreSettingsInput) {
    return this.stores.updateSettings(body);
  }

  @Get('current/pix')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Chave PIX do QR Code estático' })
  getPix() {
    return this.stores.getPix();
  }

  @Patch('current/pix')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Define ou remove a chave PIX (validada e normalizada)' })
  @ApiZodBody(pixSettingsSchema)
  updatePix(@ZBody(pixSettingsSchema) body: PixSettingsDto) {
    return this.stores.updatePix(body);
  }

  @Post('current/logo')
  @RequirePermissions(Permission.STORE_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Envia o logo da unidade' })
  uploadLogo(@UploadedFile() file: UploadedImage | undefined) {
    assertImage(file);
    return this.stores.updateLogo(file);
  }

  @Get('current/hours')
  @ApiOperation({ summary: 'Horários de funcionamento' })
  getHours() {
    return this.stores.getHours();
  }

  @Put('current/hours')
  @RequirePermissions(Permission.STORE_MANAGE)
  @ApiOperation({ summary: 'Substitui os horários de funcionamento' })
  @ApiZodBody(businessHoursSchema)
  replaceHours(@ZBody(businessHoursSchema) body: BusinessHoursInput) {
    return this.stores.replaceHours(body.hours);
  }

  @Get('current/status')
  @ApiOperation({ summary: 'Indica se a unidade está aberta agora' })
  async status() {
    return { isOpen: await this.stores.isOpenNow() };
  }

  @Post()
  @RequirePermissions(Permission.STORE_CREATE)
  @ApiOperation({ summary: 'Cria uma nova unidade na mesma organização' })
  @ApiZodBody(createStoreSchema)
  create(@ZBody(createStoreSchema) body: CreateStoreInput & { cnpj: string; phone: string }) {
    return this.stores.createUnit(body);
  }
}
