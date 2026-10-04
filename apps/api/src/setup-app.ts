import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig } from './core/config/app-config.service.js';

/** Global HTTP setup shared by `main.ts` and the e2e tests. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('API_CORS_ORIGINS'),
    credentials: true,
  });
  app.enableShutdownHooks();
}
