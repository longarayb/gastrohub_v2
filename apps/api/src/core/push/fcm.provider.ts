import { Injectable, Logger } from '@nestjs/common';
import { type App, cert, initializeApp } from 'firebase-admin/app';
import { type Messaging, getMessaging } from 'firebase-admin/messaging';
import { AppConfig } from '../config/app-config.service.js';
import type { PushMessage, PushProvider, PushTarget } from './push.types.js';

/** Errors that mean the device token is no longer valid (app uninstalled, data cleared). */
const GONE = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Firebase Cloud Messaging (D050): "rota nova" on the courier's Android app. The service account
 * of the Firebase project comes in FCM_SERVICE_ACCOUNT (the JSON file in base64); without it the
 * app's notices are off and the app still polls the route.
 */
@Injectable()
export class FcmProvider implements PushProvider {
  private readonly logger = new Logger('Fcm');
  readonly publicKey = null;
  private readonly messaging: Messaging | null;

  constructor(config: AppConfig) {
    const encoded = config.get('FCM_SERVICE_ACCOUNT');
    let messaging: Messaging | null = null;
    if (encoded) {
      try {
        const account = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
          project_id: string;
          client_email: string;
          private_key: string;
        };
        const app: App = initializeApp(
          {
            credential: cert({
              projectId: account.project_id,
              clientEmail: account.client_email,
              privateKey: account.private_key,
            }),
          },
          'courier-push',
        );
        messaging = getMessaging(app);
      } catch (error) {
        this.logger.error(`FCM_SERVICE_ACCOUNT inválido: ${(error as Error).message}`);
      }
    }
    this.messaging = messaging;
  }

  get enabled(): boolean {
    return !!this.messaging;
  }

  async send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'> {
    if (!this.messaging) return 'failed';
    try {
      await this.messaging.send({
        token: target.endpoint,
        notification: { title: message.title, body: message.body },
        data: { url: message.url },
        android: {
          priority: 'high',
          ttl: 15 * 60 * 1000,
          notification: { tag: message.tag, channelId: 'routes', sound: 'default' },
        },
      });
      return 'sent';
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (GONE.has(code)) return 'gone';
      this.logger.warn(`FCM falhou (${code || 'sem código'}): ${(error as Error).message}`);
      return 'failed';
    }
  }
}
