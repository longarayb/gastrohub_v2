import { Global, Module } from '@nestjs/common';
import { ImageService } from './image.service.js';
import { LocalStorageProvider, STORAGE_PROVIDER } from './storage.js';

@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: LocalStorageProvider }, ImageService],
  exports: [STORAGE_PROVIDER, ImageService],
})
export class StorageModule {}
