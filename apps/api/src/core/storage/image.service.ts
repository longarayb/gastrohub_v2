import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { ValidationError } from '../errors/domain-error.js';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.js';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface StoredImage {
  imageKey: string;
  thumbKey: string;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic']);

export interface ImageVariant {
  /** Bounding box; the image keeps its aspect ratio and is never enlarged. */
  maxSize: number;
  quality: number;
}

export const IMAGE_VARIANTS = {
  main: { maxSize: 800, quality: 80 },
  thumb: { maxSize: 240, quality: 75 },
} satisfies Record<string, ImageVariant>;

export function assertImage(file: UploadedImage | undefined): asserts file is UploadedImage {
  if (!file) throw new ValidationError('Envie uma imagem');
  if (!ACCEPTED.has(file.mimetype)) {
    throw new ValidationError('Formato inválido. Use JPG, PNG, WEBP, AVIF ou HEIC.');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('Imagem muito grande (máximo 8 MB)');
}

/** Resizes uploads to WebP (main + thumbnail), strips metadata and stores them. */
@Injectable()
export class ImageService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  /** Converts an image buffer to a WebP variant. EXIF orientation is applied, metadata dropped. */
  async toWebp(input: Buffer, variant: ImageVariant): Promise<Buffer> {
    try {
      return await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: variant.maxSize,
          height: variant.maxSize,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: variant.quality })
        .toBuffer();
    } catch {
      throw new ValidationError('Não foi possível ler a imagem. Envie outro arquivo.');
    }
  }

  /** Stores main + thumbnail under `folder` and returns their keys. */
  async storeProductImage(folder: string, file: UploadedImage): Promise<StoredImage> {
    assertImage(file);
    const [main, thumb] = await Promise.all([
      this.toWebp(file.buffer, IMAGE_VARIANTS.main),
      this.toWebp(file.buffer, IMAGE_VARIANTS.thumb),
    ]);
    const id = randomUUID();
    const imageKey = `${folder}/${id}.webp`;
    const thumbKey = `${folder}/${id}-thumb.webp`;
    await Promise.all([
      this.storage.put(imageKey, main, 'image/webp'),
      this.storage.put(thumbKey, thumb, 'image/webp'),
    ]);
    return { imageKey, thumbKey };
  }

  /** Stores a single WebP image (logos) and returns its key. */
  async storeSingle(folder: string, file: UploadedImage, maxSize = 512): Promise<string> {
    assertImage(file);
    const body = await this.toWebp(file.buffer, { maxSize, quality: 85 });
    const key = `${folder}/${randomUUID()}.webp`;
    await this.storage.put(key, body, 'image/webp');
    return key;
  }

  /** Copies an image pair (used when duplicating products). */
  async copyProductImage(folder: string, source: StoredImage): Promise<StoredImage> {
    const id = randomUUID();
    const copy = { imageKey: `${folder}/${id}.webp`, thumbKey: `${folder}/${id}-thumb.webp` };
    await Promise.all([
      this.storage.copy(source.imageKey, copy.imageKey),
      this.storage.copy(source.thumbKey, copy.thumbKey),
    ]);
    return copy;
  }

  async remove(...keys: (string | null | undefined)[]): Promise<void> {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => this.storage.delete(k)));
  }

  url(key: string | null | undefined): string | null {
    return key ? this.storage.publicUrl(key) : null;
  }
}
