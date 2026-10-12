import { Injectable } from '@nestjs/common';
import type { PlanDto, PlanInput, PlatformModule } from '@app/shared';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { Prisma, type Plan } from '../../generated/prisma/client.js';
import { BillingAccessService } from './billing-access.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import type { PlatformActor } from './platform.keys.js';

type PlanData = Omit<
  PlanInput,
  'description' | 'extraStorePriceCents' | 'trialDays' | 'modules' | 'isActive' | 'sortOrder'
> & {
  description: string | null;
  extraStorePriceCents?: number | null;
  trialDays: number;
  modules: PlatformModule[];
  isActive: boolean;
  sortOrder: number;
};

export const toPlanDto = (plan: Plan, subscribers = 0): PlanDto => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  priceCents: plan.priceCents,
  interval: plan.interval,
  trialDays: plan.trialDays,
  storeLimit: plan.storeLimit,
  extraStorePriceCents: plan.extraStorePriceCents,
  modules: plan.modules as PlatformModule[],
  isActive: plan.isActive,
  sortOrder: plan.sortOrder,
  subscribers,
});

/** Plans (D042). Editing a plan changes limits and modules of its customers, never their price. */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly billing: BillingAccessService,
  ) {}

  async list(): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { subscriptions: { where: { canceledAt: null } } } } },
    });
    return plans.map((p) => toPlanDto(p, p._count.subscriptions));
  }

  async create(input: PlanData, actor: PlatformActor): Promise<PlanDto> {
    const plan = await this.unique(
      this.prisma.$transaction(async (tx) => {
        const created = await tx.plan.create({ data: this.data(input) });
        await this.audit.log(
          {
            action: PlatformAuditAction.PLAN_CREATED,
            entity: 'Plan',
            entityId: created.id,
            after: created,
          },
          actor,
          tx,
        );
        return created;
      }),
    );
    return toPlanDto(plan);
  }

  async update(id: string, input: PlanData, actor: PlatformActor): Promise<PlanDto> {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Plano');
    const plan = await this.unique(
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.plan.update({ where: { id }, data: this.data(input) });
        await this.audit.log(
          {
            action: PlatformAuditAction.PLAN_UPDATED,
            entity: 'Plan',
            entityId: id,
            before,
            after: updated,
          },
          actor,
          tx,
        );
        return updated;
      }),
    );
    // Limits and modules of every customer on this plan may have changed.
    this.billing.invalidate();
    const subscribers = await this.prisma.subscription.count({
      where: { planId: id, canceledAt: null },
    });
    return toPlanDto(plan, subscribers);
  }

  private data(input: PlanData) {
    return {
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      interval: input.interval,
      trialDays: input.trialDays,
      storeLimit: input.storeLimit,
      extraStorePriceCents: input.extraStorePriceCents ?? null,
      modules: input.modules,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    };
  }

  private unique<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Já existe um plano com esse nome');
      }
      throw error;
    });
  }
}
