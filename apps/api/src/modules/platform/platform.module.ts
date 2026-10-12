import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BillingAccessService } from './billing-access.service.js';
import { BILLING_PROVIDER, ManualBillingProvider } from './billing-provider.js';
import { CustomersService } from './customers.service.js';
import { InvoicesService } from './invoices.service.js';
import { OverviewService } from './overview.service.js';
import { PlatformAccessInterceptor } from './platform-access.interceptor.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformDirectoryService } from './platform-directory.service.js';
import { PlatformStoreController } from './platform-store.controller.js';
import { PlatformAdminController, PlatformAuthController } from './platform.controller.js';
import { PlansService } from './plans.service.js';
import { PlatformSettingsService } from './settings.service.js';
import { StoreNoticesService } from './store-notices.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SupportService } from './support.service.js';

/**
 * Platform administration (D041–D044). Global only to export BillingAccessService: the
 * restaurant side's single, explicit path to its own organization's billing state.
 */
@Global()
@Module({
  controllers: [PlatformAuthController, PlatformAdminController, PlatformStoreController],
  providers: [
    PlatformAuthGuard,
    PlatformAuthService,
    PlatformAuditService,
    PlatformDirectoryService,
    BillingAccessService,
    CustomersService,
    SubscriptionsService,
    PlansService,
    InvoicesService,
    OverviewService,
    PlatformSettingsService,
    SupportService,
    StoreNoticesService,
    { provide: BILLING_PROVIDER, useClass: ManualBillingProvider },
    { provide: APP_INTERCEPTOR, useClass: PlatformAccessInterceptor },
  ],
  exports: [BillingAccessService, PlatformAuthService],
})
export class PlatformModule {}
