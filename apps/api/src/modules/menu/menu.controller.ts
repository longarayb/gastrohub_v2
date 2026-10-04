import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CategorySizesInput,
  type ModifierGroupData,
  type PauseInput,
  Permission,
  type ProductData,
  type ProductListQuery,
  type SalesChannel,
  type SectorInput,
  categorySchema,
  categorySizesSchema,
  modifierGroupSchema,
  pauseSchema,
  productListQuerySchema,
  productSchema,
  reorderSchema,
  sectorSchema,
  zSalesChannel,
} from '@app/shared';
import { z } from 'zod';
import {
  MAX_UPLOAD_BYTES,
  type UploadedImage,
  assertImage,
} from '../../core/storage/image.service.js';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { CatalogService } from './catalog.service.js';
import { CategoriesService } from './categories.service.js';
import { ModifierGroupsService } from './modifier-groups.service.js';
import { ProductsService } from './products.service.js';
import { SectorsService } from './sectors.service.js';

const imageUpload = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }));
const ApiImageBody = () =>
  ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  });

const productReorderSchema = reorderSchema.extend({ categoryId: z.string().min(1) });
const catalogQuerySchema = z.object({ channel: zSalesChannel.default('DINE_IN') });

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/sectors')
export class SectorsController {
  constructor(private readonly sectors: SectorsService) {}

  @Get()
  @RequirePermissions(Permission.MENU_READ)
  @ApiOperation({ summary: 'Lista os setores de produção' })
  list() {
    return this.sectors.list();
  }

  @Post()
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(sectorSchema)
  create(@ZBody(sectorSchema) body: SectorInput) {
    return this.sectors.create(body);
  }

  @Post('reorder')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(reorderSchema)
  reorder(@ZBody(reorderSchema) body: { ids: string[] }) {
    return this.sectors.reorder(body.ids);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(sectorSchema)
  update(@Param('id') id: string, @ZBody(sectorSchema) body: SectorInput) {
    return this.sectors.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Exclui o setor (produtos passam a usar o setor padrão)' })
  async remove(@Param('id') id: string) {
    await this.sectors.remove(id);
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(Permission.MENU_READ)
  @ApiOperation({ summary: 'Lista as categorias na ordem do cardápio' })
  list() {
    return this.categories.list();
  }

  @Post()
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(categorySchema)
  create(@ZBody(categorySchema) body: z.output<typeof categorySchema>) {
    return this.categories.create(body);
  }

  @Post('reorder')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Reordena as categorias (lista de ids na nova ordem)' })
  @ApiZodBody(reorderSchema)
  reorder(@ZBody(reorderSchema) body: { ids: string[] }) {
    return this.categories.reorder(body.ids);
  }

  @Get(':id')
  @RequirePermissions(Permission.MENU_READ)
  get(@Param('id') id: string) {
    return this.categories.get(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(categorySchema)
  update(@Param('id') id: string, @ZBody(categorySchema) body: z.output<typeof categorySchema>) {
    return this.categories.update(id, body);
  }

  @Put(':id/sizes')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Define os tamanhos de uma categoria de pizza' })
  @ApiZodBody(categorySizesSchema)
  setSizes(@Param('id') id: string, @ZBody(categorySizesSchema) body: CategorySizesInput) {
    return this.categories.setSizes(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.MENU_MANAGE)
  async remove(@Param('id') id: string) {
    await this.categories.remove(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  @ApiOperation({ summary: 'Pausa a categoria ("Acabou" = até o fim do dia de negócio)' })
  @ApiZodBody(pauseSchema)
  pause(@Param('id') id: string, @ZBody(pauseSchema) body: PauseInput) {
    return this.categories.pause(id, body);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  resume(@Param('id') id: string) {
    return this.categories.resume(id);
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(Permission.MENU_READ)
  @ApiOperation({ summary: 'Lista produtos com busca e filtros' })
  @ApiZodQuery(productListQuerySchema)
  list(@ZQuery(productListQuerySchema) query: z.output<typeof productListQuerySchema>) {
    return this.products.list(query as ProductListQuery & typeof query);
  }

  @Post()
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(productSchema)
  create(@ZBody(productSchema) body: ProductData) {
    return this.products.create(body);
  }

  @Post('reorder')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Reordena os produtos de uma categoria' })
  @ApiZodBody(productReorderSchema)
  reorder(@ZBody(productReorderSchema) body: { categoryId: string; ids: string[] }) {
    return this.products.reorder(body.categoryId, body.ids);
  }

  @Get(':id')
  @RequirePermissions(Permission.MENU_READ)
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Atualiza o produto (alterações de preço vão para a auditoria)' })
  @ApiZodBody(productSchema)
  update(@Param('id') id: string, @ZBody(productSchema) body: ProductData) {
    return this.products.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.MENU_MANAGE)
  async remove(@Param('id') id: string) {
    await this.products.remove(id);
  }

  @Post(':id/duplicate')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiOperation({ summary: 'Duplica o produto (a cópia começa pausada)' })
  duplicate(@Param('id') id: string) {
    return this.products.duplicate(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  @ApiOperation({ summary: 'Pausa o produto ("Acabou" = até o fim do dia de negócio)' })
  @ApiZodBody(pauseSchema)
  pause(@Param('id') id: string, @ZBody(pauseSchema) body: PauseInput) {
    return this.products.pause(id, body);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  resume(@Param('id') id: string) {
    return this.products.resume(id);
  }

  @Post(':id/sizes/:sizeId/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  @ApiOperation({ summary: 'Pausa um tamanho do produto (ex.: acabou o 2 L)' })
  @ApiZodBody(pauseSchema)
  pauseSize(
    @Param('id') id: string,
    @Param('sizeId') sizeId: string,
    @ZBody(pauseSchema) body: PauseInput,
  ) {
    return this.products.setSizePause(id, sizeId, body);
  }

  @Post(':id/sizes/:sizeId/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  resumeSize(@Param('id') id: string, @Param('sizeId') sizeId: string) {
    return this.products.setSizePause(id, sizeId, null);
  }

  @Post(':id/image')
  @RequirePermissions(Permission.MENU_MANAGE)
  @imageUpload()
  @ApiConsumes('multipart/form-data')
  @ApiImageBody()
  @ApiOperation({ summary: 'Envia a foto (convertida para WebP, com miniatura)' })
  setImage(@Param('id') id: string, @UploadedFile() file: UploadedImage | undefined) {
    assertImage(file);
    return this.products.setImage(id, file);
  }

  @Delete(':id/image')
  @RequirePermissions(Permission.MENU_MANAGE)
  removeImage(@Param('id') id: string) {
    return this.products.removeImage(id);
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly groups: ModifierGroupsService) {}

  @Get()
  @RequirePermissions(Permission.MENU_READ)
  @ApiOperation({ summary: 'Lista os grupos de complementos reutilizáveis' })
  list() {
    return this.groups.list();
  }

  @Post()
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(modifierGroupSchema)
  create(@ZBody(modifierGroupSchema) body: ModifierGroupData) {
    return this.groups.create(body);
  }

  @Get(':id')
  @RequirePermissions(Permission.MENU_READ)
  get(@Param('id') id: string) {
    return this.groups.get(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MENU_MANAGE)
  @ApiZodBody(modifierGroupSchema)
  update(@Param('id') id: string, @ZBody(modifierGroupSchema) body: ModifierGroupData) {
    return this.groups.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.MENU_MANAGE)
  async remove(@Param('id') id: string) {
    await this.groups.remove(id);
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/modifier-options')
export class ModifierOptionsController {
  constructor(private readonly groups: ModifierGroupsService) {}

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  @ApiOperation({ summary: 'Pausa uma opção de complemento' })
  @ApiZodBody(pauseSchema)
  pause(@Param('id') id: string, @ZBody(pauseSchema) body: PauseInput) {
    return this.groups.setOptionPause(id, body);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.MENU_PAUSE)
  resume(@Param('id') id: string) {
    return this.groups.setOptionPause(id, null);
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions(Permission.MENU_READ)
  @ApiOperation({
    summary: 'Cardápio resolvido para um canal (preços, complementos, disponibilidade)',
  })
  @ApiZodQuery(catalogQuerySchema)
  get(@ZQuery(catalogQuerySchema) query: { channel: SalesChannel }) {
    return this.catalog.build({ channel: query.channel });
  }
}
