/** A Web Push message (shown by the service worker of the panel, `public/sw.js`). */
export interface PushMessage {
  title: string;
  body: string;
  /** Page opened by a tap on the notification. */
  url: string;
  /** Same tag = the new notification replaces the previous one (one "rota" notice at a time). */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends to the browser's push service (D049). `gone` = the subscription no longer exists (the
 * user turned the notices off or reinstalled): the caller deletes it.
 */
export interface PushProvider {
  readonly publicKey: string | null;
  send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
