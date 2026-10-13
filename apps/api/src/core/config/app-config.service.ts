import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.js';

/** Typed accessor for validated environment variables. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  /**
   * Session cookies only over HTTPS in production, except on a home network server (LAN_SERVER),
   * which serves plain http on the local network (browsers drop Secure cookies over http).
   */
  get secureCookies(): boolean {
    return this.isProduction && !this.get('LAN_SERVER');
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
