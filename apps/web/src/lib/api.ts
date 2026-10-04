import type { ApiErrorBody, AuthSession } from '@app/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiErrorBody>,
  ) {
    super(body.message ?? 'Erro de comunicação com o servidor');
  }

  /** Field errors from validation responses: { "address.cep": "CEP inválido" } */
  get fieldErrors(): Record<string, string> {
    const details = Array.isArray(this.body.details) ? this.body.details : [];
    return Object.fromEntries(
      details
        .filter((d): d is { path: string; message: string } => typeof d?.path === 'string')
        .map((d) => [d.path, d.message]),
    );
  }
}

// ---- Access token kept in memory (never in localStorage) ----
let accessToken: string | null = null;
let onSessionRefreshed: ((session: AuthSession) => void) | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setSessionHandlers(handlers: {
  refreshed: (session: AuthSession) => void;
  expired: () => void;
}): void {
  onSessionRefreshed = handlers.refreshed;
  onSessionExpired = handlers.expired;
}

let refreshing: Promise<AuthSession | null> | null = null;

/** Exchanges the httpOnly refresh cookie for a new session. Single-flight. */
export function refreshSession(): Promise<AuthSession | null> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return null;
      const session = (await res.json()) as AuthSession;
      setAccessToken(session.accessToken);
      onSessionRefreshed?.(session);
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
  /** Skip the automatic refresh-and-retry on 401. */
  noRetry?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`/api${path}`, API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, noRetry, headers, ...init } = options;
  const isForm = body instanceof FormData;

  const doFetch = () =>
    fetch(buildUrl(path, query), {
      ...init,
      credentials: 'include',
      headers: {
        ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, { message: 'Sem conexão com o servidor. Verifique sua internet.' });
  }

  if (res.status === 401 && !noRetry && accessToken) {
    const session = await refreshSession();
    if (session) {
      res = await doFetch();
    } else {
      onSessionExpired?.();
    }
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
export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Message to show in a toast for any thrown error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Ocorreu um erro inesperado';
}
