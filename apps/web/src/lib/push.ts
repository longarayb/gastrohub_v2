import type { PushConfigDto } from '@app/shared';
import { api, apiGet, apiPost } from './api';

/**
 * Web Push of this browser (D049). On the iPhone it only exists in the app added to the home
 * screen (iOS 16.4+), and the permission must follow a tap. The subscription is renewed when the
 * server key changes (development makes a new key at each start).
 */
export type PushState =
  | 'unsupported'
  /** iPhone in a Safari tab: add to the home screen first. */
  | 'needs-install'
  /** The server has no push keys. */
  | 'server-off'
  | 'denied'
  | 'off'
  | 'on';

export const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports a Mac; touch tells them apart.
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** Subscribes (or renews) and tells the API; only after a tap when asking the permission. */
async function subscribe(publicKey: string): Promise<void> {
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  await apiPost('/push/subscriptions', subscription.toJSON());
}

/** Current state; when already allowed, renews the subscription silently. */
export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  const { publicKey } = await apiGet<PushConfigDto>('/push/config');
  if (!publicKey) return 'server-off';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!(await reg?.pushManager.getSubscription())) return 'off';
  await subscribe(publicKey);
  return 'on';
}

/** "Ativar avisos" (must run from a tap: iPhone refuses the permission otherwise). */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { publicKey } = await apiGet<PushConfigDto>('/push/config');
  if (!publicKey) return 'server-off';
  await subscribe(publicKey);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await api('/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    });
    await subscription.unsubscribe();
  }
  return 'off';
}
