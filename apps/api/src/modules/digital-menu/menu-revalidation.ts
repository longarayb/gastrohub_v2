import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { AppConfig } from '../../core/config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

/** Changes under these API paths alter what the digital menu shows. */
const MENU_PATHS = [
  '/api/menu/',
  '/api/stores/current',
  '/api/digital-menu/',
  '/api/delivery/areas',
];
const DEBOUNCE_MS = 1_000;

/**
 * Refreshes the cached digital menu pages of a restaurant (D032) by calling the menu app with a
 * shared secret. Debounced per store; failures only log (the cache also expires by itself).
 */
@Injectable()
export class MenuRevalidationService {
  private readonly logger = new Logger('MenuRevalidation');
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return !!this.config.get('MENU_REVALIDATE_SECRET');
  }

  schedule(tenantId: string): void {
    if (!this.enabled) return;
    clearTimeout(this.pending.get(tenantId));
    const timer = setTimeout(() => {
      this.pending.delete(tenantId);
      void this.revalidate(tenantId);
    }, DEBOUNCE_MS);
    timer.unref();
    this.pending.set(tenantId, timer);
  }

  private async revalidate(tenantId: string): Promise<void> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: tenantId },
        select: { slug: true },
      });
      if (!store) return;
      const response = await fetch(`${this.config.get('MENU_INTERNAL_URL')}/api/revalidate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.config.get('MENU_REVALIDATE_SECRET'),
        },
        body: JSON.stringify({ slug: store.slug }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) this.logger.warn(`Cardápio respondeu ${response.status} na revalidação`);
    } catch (error) {
      this.logger.warn(`Revalidação do cardápio falhou: ${(error as Error).message}`);
    }
  }
}

/** After a successful change of the menu, the store or the delivery areas: refresh the menu. */
@Injectable()
export class MenuRevalidationInterceptor implements NestInterceptor {
  constructor(
    private readonly revalidation: MenuRevalidationService,
    private readonly ctx: TenantContext,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const changes = req.method !== 'GET' && MENU_PATHS.some((p) => req.originalUrl.startsWith(p));
    if (!changes) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const tenantId = this.ctx.tenantIdOrNull;
        if (tenantId) this.revalidation.schedule(tenantId);
      }),
    );
  }
}
