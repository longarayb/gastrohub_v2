import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service.js';

/**
 * File storage abstraction. Local disk in development; an S3/R2 adapter can implement
 * the same interface later without touching the domain (the DB stores keys, not URLs).
 */
export interface StorageProvider {
  /** Stores `body` under `key` (e.g. "t/abc/products/xyz.webp"). Overwrites. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Copies an object to a new key. */
  copy(sourceKey: string, targetKey: string): Promise<void>;
  /** Removes the object; missing keys are ignored. */
  delete(key: string): Promise<void>;
  /** Public URL of a key. */
  publicUrl(key: string): string;
  /** Inverse of `publicUrl` for URLs produced by this provider; `null` otherwise. */
  keyFromUrl(url: string): string | null;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export const InjectStorage = () => Inject(STORAGE_PROVIDER);

export const UPLOADS_ROUTE = '/uploads';

export function storageRoot(config: AppConfig): string {
  return path.resolve(process.cwd(), config.get('STORAGE_DIR'));
}

/** Keys are relative paths made of safe segments only. */
export function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly config: AppConfig) {}

  private filePath(key: string): string {
    assertSafeKey(key);
    return path.join(storageRoot(this.config), ...key.split('/'));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    const target = this.filePath(targetKey);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(this.filePath(sourceKey), target);
  }

  async delete(key: string): Promise<void> {
    await unlink(this.filePath(key)).catch(() => undefined);
  }

  publicUrl(key: string): string {
    return `${this.config.get('API_PUBLIC_URL')}${UPLOADS_ROUTE}/${key}`;
  }

  keyFromUrl(url: string): string | null {
    const prefix = `${this.config.get('API_PUBLIC_URL')}${UPLOADS_ROUTE}/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    try {
      assertSafeKey(key);
      return key;
    } catch {
      return null;
    }
  }
}
