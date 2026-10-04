import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CategoriesService } from './categories.service.js';
import {
  CatalogController,
  CategoriesController,
  ModifierGroupsController,
  ModifierOptionsController,
  ProductsController,
  SectorsController,
} from './menu.controller.js';
import { MenuContext } from './menu-common.js';
import { ModifierGroupsService } from './modifier-groups.service.js';
import { ProductsService } from './products.service.js';
import { SectorsService } from './sectors.service.js';

@Module({
  controllers: [
    SectorsController,
    CategoriesController,
    ProductsController,
    ModifierGroupsController,
    ModifierOptionsController,
    CatalogController,
  ],
  providers: [
    MenuContext,
    SectorsService,
    CategoriesService,
    ProductsService,
    ModifierGroupsService,
    CatalogService,
  ],
  exports: [CatalogService, MenuContext],
})
export class MenuModule {}
