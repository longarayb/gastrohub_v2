'use client';

import {
  type AuthSession,
  type LoginInput,
  type Permission,
  type RegisterInput,
  hasPermission,
} from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionHandlers } from './api';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: Status;
  session: AuthSession | null;
  login: (input: LoginInput) => Promise<AuthSession>;
  register: (input: RegisterInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
  can: (permission: Permission) => boolean;
  setSession: (session: AuthSession) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const queryClient = useQueryClient();

  const setSession = useCallback((next: AuthSession | null) => {
    setAccessToken(next?.accessToken ?? null);
    setSessionState(next);
    setStatus(next ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    setSessionHandlers({
      refreshed: (s) => setSession(s),
      expired: () => {
        setSession(null);
        queryClient.clear();
      },
    });
    // Restore the session from the refresh cookie on first load.
    void refreshSession().then((s) => setSession(s));
  }, [queryClient, setSession]);

  // Renew the access token shortly before it expires.
  useEffect(() => {
    if (!session) return;
    const ms = Math.max(30_000, (session.expiresIn - 60) * 1000);
    const timer = setTimeout(() => void refreshSession(), ms);
    return () => clearTimeout(timer);
  }, [session]);

  const login = useCallback(
    async (input: LoginInput) => {
      const s = await api<AuthSession>('/auth/login', {
        method: 'POST',
        body: input,
        noRetry: true,
      });
      queryClient.clear();
      setSession(s);
      return s;
    },
    [queryClient, setSession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const s = await api<AuthSession>('/auth/register', {
        method: 'POST',
        body: input,
        noRetry: true,
      });
      queryClient.clear();
      setSession(s);
      return s;
    },
    [queryClient, setSession],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', noRetry: true }).catch(() => undefined);
    // Full navigation: drops all in-memory state and avoids the protected layout
    // redirecting to /login?next=<current page>, which the next user may not access.
    setAccessToken(null);
    window.location.replace('/login');
  }, []);

  const switchStore = useCallback(
    async (storeId: string) => {
      const s = await api<AuthSession>('/auth/switch-store', { method: 'POST', body: { storeId } });
      // Every cached query belongs to the previous store.
      queryClient.clear();
      setSession(s);
    },
    [queryClient, setSession],
  );

  const can = useCallback(
    (permission: Permission) => hasPermission(session?.role, permission),
    [session?.role],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, login, register, logout, switchStore, can, setSession }),
    [status, session, login, register, logout, switchStore, can, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Session guaranteed to exist (use inside the authenticated area). */
export function useSession(): AuthSession {
  const { session } = useAuth();
  if (!session) throw new Error('No active session');
  return session;
}
