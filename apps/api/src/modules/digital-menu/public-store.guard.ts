import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { NotFoundError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

/**
 * Public digital menu routes (`/public/:slug/...`): resolves the restaurant by its slug (raw
 * client, the documented exception) and runs the request in its tenant context, so the rest
 * uses the same tenant-scoped services as the panel.
 */
@Injectable()
export class PublicStoreGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const slug = String(req.params.slug ?? '').toLowerCase();
    if (!/^[a-z0-9-]{2,80}$/.test(slug)) throw new NotFoundError('Restaurante');
    const store = await this.prisma.store.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });
    if (!store?.isActive) throw new NotFoundError('Restaurante');
    this.ctx.set({ tenantId: store.id });
    return true;
  }
}
