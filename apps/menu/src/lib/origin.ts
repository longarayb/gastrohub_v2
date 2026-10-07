import { headers } from 'next/headers';
import { MENU_URL } from './api';

/**
 * Public origin of the current request (absolute links: link preview image, canonical, JSON-LD).
 * Behind a proxy or a temporary tunnel the forwarded host is used, so the preview image URL is
 * the one the visitor (or WhatsApp) reached, not the address of the build.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host'))?.split(',')[0]?.trim();
  if (!host || !/^[a-z0-9.:-]+$/i.test(host)) return MENU_URL;
  const local = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(host);
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (local ? 'http' : 'https');
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}
