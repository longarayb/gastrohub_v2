/** A push message: shown by the panel's service worker (`public/sw.js`) or the Android app. */
export interface PushMessage {
  title: string;
  body: string;
  /** Page opened by a tap on the notification. */
  url: string;
  /** Same tag = the new notification replaces the previous one (one "rota" notice at a time). */
  tag?: string;
}

export interface PushTarget {
  /** Browser endpoint (Web Push) or the device token (FCM). */
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

/**
 * Sends to a push service (D049 Web Push, D050 Firebase). `gone` = the subscription no longer
 * exists (notices turned off, app reinstalled): the caller deletes it.
 */
export interface PushProvider {
  /** VAPID public key (Web Push); null when this provider is off. */
  readonly publicKey: string | null;
  send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'>;
}

/** Web Push (browsers). */
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
/** Firebase Cloud Messaging (the Android app). */
export const FCM_PROVIDER = Symbol('FCM_PROVIDER');
