import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig } from './core/config/app-config.service.js';
import { UPLOADS_ROUTE, storageRoot } from './core/storage/storage.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/** Global HTTP setup shared by `main.ts` and the e2e tests. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api');
  // Real client IP behind the reverse proxy (digital menu limits, throttling).
  (app as NestExpressApplication).set('trust proxy', config.get('TRUST_PROXY'));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('API_CORS_ORIGINS'),
    credentials: true,
  });
  // Uploaded images (local storage provider).
  (app as NestExpressApplication).useStaticAssets(storageRoot(config), {
    prefix: UPLOADS_ROUTE,
    maxAge: '7d',
    index: false,
  });
  // Socket.IO with Redis pub/sub and the same CORS origins as the HTTP API.
  const ioAdapter = new RedisIoAdapter(
    app,
    config.get('REDIS_URL'),
    config.get('API_CORS_ORIGINS'),
  );
  ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);
  app.enableShutdownHooks();
}
