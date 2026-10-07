/**
 * Access to the public API of the digital menu. On the server (pages, metadata) the API may be
 * reached through an internal address; in the browser through the public one.
 */
const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
const SERVER_API = process.env.API_INTERNAL_URL || PUBLIC_API;

export const MENU_URL = process.env.NEXT_PUBLIC_MENU_URL ?? 'http://localhost:3001';

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { message?: string; details?: unknown },
  ) {
    super(body.message ?? 'Não foi possível falar com o restaurante. Tente de novo.');
  }

  /** Field errors of a 400 response: { "customer.phone": "..." }. */
  get fieldErrors(): Record<string, string> {
    const details = Array.isArray(this.body.details) ? this.body.details : [];
    return Object.fromEntries(
      details
        .filter((d): d is { path: string; message: string } => typeof d?.path === 'string')
        .map((d) => [d.path, d.message]),
    );
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new PublicApiError(0, {
      message: 'Sem conexão. Confira a internet e tente de novo.',
    });
  }
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new PublicApiError(response.status, body);
  return body;
}

/** Server components: cached with tags (refreshed by the API when the menu changes). */
export function serverGet<T>(
  path: string,
  cache: { tags: string[]; revalidate: number | false } | 'no-store',
): Promise<T> {
  return request<T>(
    SERVER_API,
    path,
    cache === 'no-store' ? { cache: 'no-store' } : { next: cache },
  );
}

/** Browser calls (cart, order, tracking). */
export function clientApi<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
) {
  return request<T>(PUBLIC_API, path, {
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    headers: init?.headers,
  });
}

export const API_ORIGIN = PUBLIC_API;

/** Tags of a restaurant's cached pages (the API refreshes them after menu changes). */
export const storeTag = (slug: string) => `store:${slug}`;
