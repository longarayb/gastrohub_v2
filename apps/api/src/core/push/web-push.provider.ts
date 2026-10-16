import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../config/app-config.service.js';
import type { PushMessage, PushProvider, PushTarget } from './push.types.js';

const TTL_SECONDS = 15 * 60;

/** Web Push with VAPID keys (the `web-push` library talks to FCM, Apple and Mozilla). */
@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('Push');
  readonly publicKey: string | null;
  private readonly privateKey: string | null;
  private readonly subject: string;

  constructor(config: AppConfig) {
    let publicKey = config.get('VAPID_PUBLIC_KEY') || null;
    let privateKey = config.get('VAPID_PRIVATE_KEY') || null;
    if ((!publicKey || !privateKey) && !config.isProduction) {
      // Development: a temporary pair; the phones notice the new key and subscribe again.
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY vazios: chaves temporárias de push');
    }
    this.publicKey = publicKey && privateKey ? publicKey : null;
    this.privateKey = this.publicKey ? privateKey : null;
    this.subject = config.get('VAPID_SUBJECT') || `mailto:${config.get('MAIL_FROM_ADDRESS')}`;
    if (!this.publicKey)
      this.logger.warn('Push desligado: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY vazios');
  }

  async send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'> {
    if (!this.publicKey || !this.privateKey) return 'failed';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          TTL: TTL_SECONDS,
          urgency: 'high',
          topic: message.tag,
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
          timeout: 10_000,
        },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // 403: the subscription was made with another key (development restart).
      if (status === 403) return 'gone';
      this.logger.warn(`Push falhou (${status ?? 'sem resposta'}): ${(error as Error).message}`);
      return 'failed';
    }
  }
}
