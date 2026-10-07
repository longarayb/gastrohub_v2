import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './core/audit/audit.module.js';
import { AppConfigModule } from './core/config/config.module.js';
import { AllExceptionsFilter } from './core/errors/all-exceptions.filter.js';
import { GeocodingModule } from './core/geocoding/geocoding.module.js';
import { MailModule } from './core/mail/mail.module.js';
import { PrismaModule } from './core/prisma/prisma.module.js';
import { QueueModule } from './core/queue/queue.module.js';
import { StorageModule } from './core/storage/storage.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CashModule } from './modules/cash/cash.module.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { DigitalMenuModule } from './modules/digital-menu/digital-menu.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { KdsModule } from './modules/kds/kds.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PrintingModule } from './modules/printing/printing.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { StoresModule } from './modules/stores/stores.module.js';
import { UsersModule } from './modules/users/users.module.js';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : isDev ? 'debug' : 'info',
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
        transport:
          isDev && !isTest
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              }
            : undefined,
      },
    }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    // Generous default; sensitive routes (login, reset) have stricter @Throttle limits.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 600 }],
      // Read per request so e2e suites can turn rate limiting on and off.
      skipIf: () => process.env.THROTTLE_DISABLED === 'true',
    }),
    PrismaModule,
    QueueModule,
    MailModule,
    GeocodingModule,
    AuditModule,
    StorageModule,
    AuthModule,
    HealthModule,
    StoresModule,
    UsersModule,
    MenuModule,
    RealtimeModule,
    OrdersModule,
    CashModule,
    KdsModule,
    DeliveryModule,
    DigitalMenuModule,
    PrintingModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
