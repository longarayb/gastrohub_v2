'use client';

import type { PlatformAdminDto, PlatformSessionDto } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionHandlers } from './api';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: Status;
  admin: PlatformAdminDto | null;
  /** After the 2FA step (login or enrollment). */
  signIn: (session: PlatformSessionDto) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<PlatformSessionDto | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const queryClient = useQueryClient();

  const setSession = useCallback((next: PlatformSessionDto | null) => {
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
    void refreshSession().then((s) => setSession(s));
  }, [queryClient, setSession]);

  // Renew the short access token before it expires (the session lasts up to 12 h).
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => void refreshSession(),
      Math.max(30_000, (session.expiresIn - 60) * 1000),
    );
    return () => clearTimeout(timer);
  }, [session]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', noRetry: true }).catch(() => undefined);
    setAccessToken(null);
    window.location.replace('/login');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      admin: session?.admin ?? null,
      signIn: (s) => {
        queryClient.clear();
        setSession(s);
      },
      logout,
    }),
    [status, session, logout, queryClient, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
