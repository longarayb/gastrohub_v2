/**
 * The server address typed by the courier (D050): the home network server now
 * ("192.168.0.92:3000") and the hosted one later ("painel.exemplo.com.br"), with no other APK.
 * Pure (tested).
 */
export function normalizeServer(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  // Another protocol typed (ftp://, file://): not a server address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) {
    // A bare IP or local name is the home network (http); a domain is the hosted server (https).
    const local = /^(\d{1,3}(\.\d{1,3}){3}|localhost|[^.]+)(:\d+)?(\/|$)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // The app adds /api itself: "…/api" or "…/entregas" typed by habit are removed.
    const pathname = url.pathname.replace(/\/+$/, '').replace(/\/(api|entregas)$/i, '');
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return null;
  }
}

/** http outside the home network sends the password unprotected: the screen warns. */
export function isInsecureRemote(server: string): boolean {
  const url = new URL(server);
  if (url.protocol === 'https:') return false;
  return !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(url.hostname);
}
