import type { ApiErrorBody, PlatformSessionDto } from '@app/shared';

/**
 * API address. Empty in production: the browser calls `/api` on the admin's own address and the
 * proxy forwards it (no domain inside the build; docs/PROPOSTA_HOSPEDAGEM.md).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiErrorBody>,
  ) {
    super(body.message ?? 'Erro de comunicação com o servidor');
  }

  /** Field errors from validation responses: { "customer.document": "CPF/CNPJ inválido" } */
  get fieldErrors(): Record<string, string> {
    const details = Array.isArray(this.body.details) ? this.body.details : [];
    return Object.fromEntries(
      details
        .filter((d): d is { path: string; message: string } => typeof d?.path === 'string')
        .map((d) => [d.path, d.message]),
    );
  }
}

// ---- Platform access token: memory only; renewed with the platform refresh cookie (D041) ----
let accessToken: string | null = null;
let onRefreshed: ((session: PlatformSessionDto) => void) | null = null;
let onExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionHandlers(handlers: {
  refreshed: (session: PlatformSessionDto) => void;
  expired: () => void;
}): void {
  onRefreshed = handlers.refreshed;
  onExpired = handlers.expired;
}

let refreshing: Promise<PlatformSessionDto | null> | null = null;

/** Exchanges the httpOnly platform refresh cookie for a new session. Single-flight. */
export function refreshSession(): Promise<PlatformSessionDto | null> {
  refreshing ??= fetch(`${API_URL}/api/platform/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const session = (await res.json()) as PlatformSessionDto;
      accessToken = session.accessToken;
      onRefreshed?.(session);
      return session;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Query;
  noRetry?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`/api/platform${path}`, API_URL || window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Calls the platform admin API (/api/platform/...). */
export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, noRetry, headers, ...init } = options;
  const doFetch = () =>
    fetch(buildUrl(path, query), {
      ...init,
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, { message: 'Sem conexão com o servidor. Verifique sua internet.' });
  }
  if (res.status === 401 && !noRetry && accessToken) {
    const session = await refreshSession();
    if (session) res = await doFetch();
    else onExpired?.();
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data === 'object' && data ? data : { message: String(data) },
    );
  }
  return data as T;
}

export const apiGet = <T>(path: string, query?: Query) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Ocorreu um erro inesperado';
}
