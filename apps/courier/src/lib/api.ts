import { APP_CLIENT_HEADER, type AuthSession, COURIER_APP_CLIENT } from '@app/shared';
import { storage } from './storage';

/** A failed call: status 0 = no connection (the offline queue retries). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The session ended (refresh refused): the app goes back to the login. */
export class SessionEndedError extends ApiError {
  constructor() {
    super(401, 'Sua sessão terminou. Entre de novo.');
  }
}

const TIMEOUT_MS = 15_000;
let refreshing: Promise<string> | null = null;

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Response> {
  const server = await storage.getServer();
  if (!server) throw new ApiError(0, 'Configure o endereço do servidor');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${server}/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        [APP_CLIENT_HEADER]: COURIER_APP_CLIENT,
        ...(options.token && { Authorization: `Bearer ${options.token}` }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  } finally {
    clearTimeout(timer);
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
  return new ApiError(res.status, body?.message ?? `Erro ${res.status}`, body?.code);
}

async function saveSession(session: AuthSession): Promise<void> {
  if (!session.refreshToken) throw new ApiError(500, 'O servidor não devolveu a sessão do app');
  await storage.setTokens(session.accessToken, session.refreshToken);
  await storage.setSession({ userName: session.user.name, storeName: session.store.tradeName });
}

/**
 * Renews the access token once at a time (the screens and the location task share it): two
 * renewals with the same token would end the session.
 */
function refreshAccess(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await storage.getRefresh();
      if (!refreshToken) throw new SessionEndedError();
      const res = await call('/auth/refresh', { method: 'POST', body: { refreshToken } });
      if (res.status === 401) {
        await storage.clearSession();
        throw new SessionEndedError();
      }
      if (!res.ok) throw await errorOf(res);
      const session = (await res.json()) as AuthSession;
      await saveSession(session);
      return session.accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Signed-in call; renews the token on 401 and tries once more. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  let token = await storage.getAccess();
  if (!token) token = await refreshAccess();
  let res = await call(path, { ...options, token });
  if (res.status === 401) {
    token = await refreshAccess();
    res = await call(path, { ...options, token });
  }
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Public call (server check, latest version). */
export async function publicApi<T>(path: string): Promise<T> {
  const res = await call(path);
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<void> {
  const res = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (!res.ok) throw await errorOf(res);
  const session = (await res.json()) as AuthSession;
  if (session.role !== 'COURIER') {
    throw new ApiError(403, 'Este app é só para entregadores. Use o painel no navegador.');
  }
  await saveSession(session);
}

export async function logout(): Promise<void> {
  const refreshToken = await storage.getRefresh();
  if (refreshToken) {
    await call('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => null);
  }
  await storage.clearSession();
}
