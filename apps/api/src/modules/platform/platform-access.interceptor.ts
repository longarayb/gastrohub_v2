import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ErrorCode,
  PLATFORM_MODULE_LABELS,
  PLATFORM_SUPPORT_ROLE,
  type PlatformModule,
  isReadOnlyMethod,
} from '@app/shared';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { DomainError, ForbiddenError } from '../../core/errors/domain-error.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { BillingAccessService } from './billing-access.service.js';
import { CREATES_SALE_KEY, DENY_SUPPORT_KEY, REQUIRES_MODULE_KEY } from './billing.decorators.js';

export const READ_ONLY_MESSAGE =
  'Esta unidade está em modo somente leitura por pendência na mensalidade. Consultas e relatórios continuam disponíveis; novas vendas voltam assim que o pagamento for registrado.';

/**
 * Runs after the guards (so public digital menu routes already have their tenant):
 *  - read-only mode of overdue organizations blocks only routes that start a sale (D042);
 *  - plan modules (D042);
 *  - platform support sessions: read-only unless opened "with changes", never the user's own
 *    account routes (D041).
 */
@Injectable()
export class PlatformAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: TenantContext,
    private readonly billing: BillingAccessService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const tenantId = this.ctx.tenantIdOrNull;
    if (!tenantId) return next.handle();
    const targets = [context.getHandler(), context.getClass()];

    if (this.ctx.role === PLATFORM_SUPPORT_ROLE) {
      if (this.reflector.getAllAndOverride<boolean>(DENY_SUPPORT_KEY, targets)) {
        throw new ForbiddenError('Não disponível no acesso de suporte');
      }
      const req = context.switchToHttp().getRequest<Request>();
      if (this.ctx.supportMode !== 'READ_WRITE' && !isReadOnlyMethod(req.method)) {
        throw new ForbiddenError('Acesso de suporte em modo somente leitura');
      }
    }

    const createsSale = this.reflector.getAllAndOverride<boolean>(CREATES_SALE_KEY, targets);
    const module = this.reflector.getAllAndOverride<PlatformModule | undefined>(
      REQUIRES_MODULE_KEY,
      targets,
    );
    if (createsSale || module) {
      const { billing, access } = await this.billing.forStore(tenantId);
      if (module && billing && !billing.modules.includes(module)) {
        throw new DomainError(
          `${PLATFORM_MODULE_LABELS[module]} não faz parte do plano contratado.`,
          ErrorCode.PLAN_LIMIT,
          403,
        );
      }
      if (createsSale && access?.readOnly) {
        throw new DomainError(READ_ONLY_MESSAGE, ErrorCode.READ_ONLY, 403);
      }
    }
    return next.handle();
  }
}
