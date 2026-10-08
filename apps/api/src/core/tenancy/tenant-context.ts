import { Injectable } from '@nestjs/common';
import type { ActorRole } from '@app/shared';
import { ClsService, type ClsStore } from 'nestjs-cls';
import { UnauthorizedError } from '../errors/domain-error.js';

export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  /** Paired device (KDS screen or print agent) instead of a user. */
  deviceId?: string;
  role?: ActorRole;
  /** Print jobs were queued in this request: nudge the agents after the commit. */
  printQueued?: boolean;
}

/** Request-scoped tenant and user information, backed by AsyncLocalStorage. */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  /** Current tenant id or `undefined` outside of an authenticated request/job. */
  get tenantIdOrNull(): string | undefined {
    return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
  }

  get tenantId(): string {
    const id = this.tenantIdOrNull;
    if (!id) throw new UnauthorizedError('Unidade não selecionada');
    return id;
  }

  get userId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userId') : undefined;
  }

  get deviceId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('deviceId') : undefined;
  }

  get role(): ActorRole | undefined {
    return this.cls.isActive() ? this.cls.get('role') : undefined;
  }

  set(values: { tenantId: string; userId?: string; deviceId?: string; role?: ActorRole }): void {
    this.cls.set('tenantId', values.tenantId);
    if (values.userId) this.cls.set('userId', values.userId);
    if (values.deviceId) this.cls.set('deviceId', values.deviceId);
    if (values.role) this.cls.set('role', values.role);
  }

  /**
   * Runs `fn` within a tenant context. Used by public endpoints (digital menu),
   * queue workers and the seed, where there is no authenticated user.
   */
  run<T>(tenantId: string, fn: () => Promise<T>, userId?: string): Promise<T> {
    return this.cls.run(async () => {
      this.set({ tenantId, userId });
      return fn();
    });
  }
}
