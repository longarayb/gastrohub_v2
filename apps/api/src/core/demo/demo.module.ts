import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DemoModeInterceptor, DemoModeService } from './demo-mode.js';

/** Public demo unit (D045): `@BlockedInDemo()` routes and `DemoModeService` for services. */
@Global()
@Module({
  providers: [DemoModeService, { provide: APP_INTERCEPTOR, useClass: DemoModeInterceptor }],
  exports: [DemoModeService],
})
export class DemoModule {}
