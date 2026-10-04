import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';
import { ValidationError } from '../errors/domain-error.js';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** File storage abstraction (local disk in development; S3-compatible later). */
export interface StorageProvider {
  /** Saves the file and returns its public URL. */
  save(folder: string, file: UploadedImage): Promise<string>;
  remove(url: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export const InjectStorage = () => Inject(STORAGE_PROVIDER);

export const UPLOADS_ROUTE = '/uploads';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function assertImage(file: UploadedImage | undefined): asserts file is UploadedImage {
  if (!file) throw new ValidationError('Envie uma imagem');
  if (!IMAGE_EXTENSIONS[file.mimetype]) {
    throw new ValidationError('Formato inválido. Use JPG, PNG ou WEBP.');
  }
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError('Imagem muito grande (máximo 3 MB)');
}

export function storageRoot(config: AppConfig): string {
  return path.resolve(process.cwd(), config.get('STORAGE_DIR'));
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly config: AppConfig) {}

  async save(folder: string, file: UploadedImage): Promise<string> {
    assertImage(file);
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '');
    const name = `${randomUUID()}.${IMAGE_EXTENSIONS[file.mimetype]}`;
    const dir = path.join(storageRoot(this.config), safeFolder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.buffer);
    return `${this.config.get('API_PUBLIC_URL')}${UPLOADS_ROUTE}/${safeFolder}/${name}`;
  }

  async remove(url: string): Promise<void> {
    const prefix = `${this.config.get('API_PUBLIC_URL')}${UPLOADS_ROUTE}/`;
    if (!url.startsWith(prefix)) return;
    const relative = url.slice(prefix.length);
    if (relative.includes('..')) return;
    await unlink(path.join(storageRoot(this.config), relative)).catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: LocalStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
