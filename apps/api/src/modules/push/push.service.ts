import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PushConfigDto, PushSubscriptionInput } from '@app/shared';
import { ForbiddenError } from '../../core/errors/domain-error.js';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from '../../core/push/push.types.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

/**
 * Web Push (D049): each browser or installed app of a user subscribes once per unit; messages go
 * to every subscription of the user, and the ones the push service says are gone are deleted.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  config(): PushConfigDto {
    return { publicKey: this.provider.publicKey };
  }

  private userId(): string {
    const userId = this.ctx.userId;
    if (!userId) throw new ForbiddenError();
    return userId;
  }

  async subscribe(input: PushSubscriptionInput, userAgent: string | null): Promise<void> {
    const userId = this.userId();
    const data = {
      userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    const existing = await this.db.pushSubscription.findFirst({
      where: { endpoint: input.endpoint },
    });
    // The same browser signed in as someone else takes the subscription over.
    if (existing) await this.db.pushSubscription.update({ where: { id: existing.id }, data });
    else await this.db.pushSubscription.create({ data: { ...data, endpoint: input.endpoint } });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.db.pushSubscription.deleteMany({ where: { endpoint, userId: this.userId() } });
  }

  /** Sends to every subscription of the user (inside the unit's tenant context). */
  async notifyUser(userId: string, message: PushMessage): Promise<number> {
    const subscriptions = await this.db.pushSubscription.findMany({ where: { userId } });
    let sent = 0;
    for (const s of subscriptions) {
      const result = await this.provider.send(s, message);
      if (result === 'sent') {
        sent++;
        await this.db.pushSubscription.update({
          where: { id: s.id },
          data: { lastSuccessAt: new Date() },
        });
      } else if (result === 'gone') {
        await this.db.pushSubscription.delete({ where: { id: s.id } });
      }
    }
    return sent;
  }

  /**
   * "Rota nova" for the courier linked to a user, after orders left with them (dispatch screen,
   * kanban or kitchen expedition). Never fails the dispatch.
   */
  async courierRun(courierId: string): Promise<void> {
    try {
      const courier = await this.db.courier.findFirst({ where: { id: courierId } });
      if (!courier?.userId) return;
      const run = await this.db.deliveryRun.findFirst({
        where: { openCourierId: courierId },
        select: { id: true, stops: { where: { deliveredAt: null, failedAt: null } } },
      });
      const pending = run?.stops.length ?? 0;
      if (!run || !pending) return;
      await this.notifyUser(courier.userId, {
        title: pending === 1 ? 'Nova entrega' : `${pending} entregas na sua rota`,
        body: 'Abra para ver os endereços e a ordem das paradas.',
        url: '/entregas',
        tag: `run-${run.id}`,
      });
    } catch (error) {
      this.logger.warn(`Aviso de rota não enviado: ${(error as Error).message}`);
    }
  }
}
