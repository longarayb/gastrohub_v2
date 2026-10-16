import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CourierAppReleaseDto } from '@app/shared';
import type { Response } from 'express';
import { AppConfig } from '../../core/config/app-config.service.js';
import { NotFoundError } from '../../core/errors/domain-error.js';
import { Public } from '../auth/auth.decorators.js';

interface LatestFile {
  versionCode: number;
  versionName: string;
  notes?: string | null;
  file: string;
  publishedAt: string;
}

/**
 * The Android courier app distributed by APK (D050): the app asks for the latest version on start
 * and offers the download. Public (the APK has no data); the files come from `servidor:apk`.
 */
@ApiTags('courier-app')
@Controller('courier-app')
export class CourierReleaseController {
  constructor(private readonly config: AppConfig) {}

  private dir(): string {
    return (
      this.config.get('COURIER_APP_DIR') || path.join(this.config.get('STORAGE_DIR'), 'courier-app')
    );
  }

  private latestFile(): LatestFile {
    const file = path.join(this.dir(), 'latest.json');
    if (!existsSync(file)) throw new NotFoundError('Versão do app');
    const latest = JSON.parse(readFileSync(file, 'utf8')) as LatestFile;
    // Only a plain file name inside the folder (never a path from the JSON).
    if (path.basename(latest.file) !== latest.file) throw new NotFoundError('Versão do app');
    return latest;
  }

  @Public()
  @Get('latest')
  @ApiOperation({ summary: 'Versão mais nova do app do entregador (Android)' })
  latest(): CourierAppReleaseDto {
    const latest = this.latestFile();
    return {
      versionCode: latest.versionCode,
      versionName: latest.versionName,
      notes: latest.notes ?? null,
      downloadPath: '/api/courier-app/download',
      publishedAt: latest.publishedAt,
    };
  }

  @Public()
  @Get('download')
  @ApiOperation({ summary: 'Baixa o APK mais novo do app do entregador' })
  download(@Res() res: Response): void {
    const latest = this.latestFile();
    const file = path.join(this.dir(), latest.file);
    if (!existsSync(file)) throw new NotFoundError('Arquivo do app');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Cache-Control', 'no-cache');
    res.download(file, `entregas-${latest.versionName}.apk`);
  }
}
