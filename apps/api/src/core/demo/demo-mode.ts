import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEMO_MODE_MESSAGE, ErrorCode } from '@app/shared';
import type { Observable } from 'rxjs';
import { DomainError } from '../errors/domain-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * Public demo unit (D045): its credentials are public, so the API refuses what would let a
 * visitor lock others out or misuse the server: users, passwords, company settings, PIX key,
 * printing, deletions, image uploads and real digital menu orders. Everything is restored at
 * night by `demo-reset`. Hiding the buttons is only a courtesy: this is the rule.
 */
export const BLOCKED_IN_DEMO_KEY = 'blockedInDemo';
export const BlockedInDemo = () => SetMetadata(BLOCKED_IN_DEMO_KEY, true);

/** A DELETE that is part of selling (removing an unsent item): allowed in the demo. */
export const ALLOWED_IN_DEMO_KEY = 'allowedInDemo';
export const AllowedInDemo = () => SetMetadata(ALLOWED_IN_DEMO_KEY, true);

export class DemoModeError extends DomainError {
  constructor() {
    super(DEMO_MODE_MESSAGE, ErrorCode.DEMO_MODE, 403);
  }
}

const CACHE_MS = 30_000;

/** Whether a unit is the public demo (cached briefly: read on every protected request). */
@Injectable()
export class DemoModeService {
  private readonly cache = new Map<string, { demo: boolean; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async isDemo(storeId: string): Promise<boolean> {
    const hit = this.cache.get(storeId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.demo;
    // The unit itself (not a tenant table): read with the raw client.
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { demoMode: true },
    });
    const demo = store?.demoMode ?? false;
    this.cache.set(storeId, { demo, at: Date.now() });
    return demo;
  }

  /** For services that decide inside (e.g. the password e-mail of a demo user). */
  async assertNotDemo(storeId: string): Promise<void> {
    if (await this.isDemo(storeId)) throw new DemoModeError();
  }
}

/** Every route marked `@BlockedInDemo()` answers 403 DEMO_MODE in the demo unit. */
@Injectable()
export class DemoModeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: TenantContext,
    private readonly demo: DemoModeService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const blocked = this.reflector.getAllAndOverride<boolean>(BLOCKED_IN_DEMO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const tenantId = this.ctx.tenantIdOrNull;
    if (blocked && tenantId && (await this.demo.isDemo(tenantId))) throw new DemoModeError();
    return next.handle();
  }
}
