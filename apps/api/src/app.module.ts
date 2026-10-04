import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './core/config/config.module.js';
import { AllExceptionsFilter } from './core/errors/all-exceptions.filter.js';
import { PrismaModule } from './core/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : isDev ? 'debug' : 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        customProps: (req) => ({
          tenantId: (req as { user?: { tenantId?: string } }).user?.tenantId,
        }),
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
        transport: isDev
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
      },
    }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
