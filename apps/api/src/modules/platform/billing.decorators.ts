import { SetMetadata } from '@nestjs/common';
import type { PlatformModule } from '@app/shared';

/** Routes that start a NEW sale: refused while the organization is in read-only mode (D042). */
export const CREATES_SALE_KEY = 'createsSale';
export const CreatesSale = () => SetMetadata(CREATES_SALE_KEY, true);

/** Routes of a plan module: refused (and hidden in the panel) when the plan does not include it. */
export const REQUIRES_MODULE_KEY = 'requiresModule';
export const RequiresModule = (module: PlatformModule) => SetMetadata(REQUIRES_MODULE_KEY, module);

/** Routes a platform support session never uses (switching store, the user's own password). */
export const DENY_SUPPORT_KEY = 'denySupport';
export const DenySupport = () => SetMetadata(DENY_SUPPORT_KEY, true);
