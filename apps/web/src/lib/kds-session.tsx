'use client';

import { type KdsDeviceSessionDto, Permission, REALTIME_EVENTS } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Socket, io } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession, setDeviceSession } from './api';
import { useAuth } from './auth';
import { kdsKeys, pairDevice, renewDeviceSession, unpairDevice } from './kds';

type KdsMode =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'device'; session: KdsDeviceSessionDto }
  | { kind: 'user' };

interface KdsSessionValue {
  mode: KdsMode;
  storeName: string | null;
  /** Pairs this tablet (store slug + 6-digit code). */
  pair: (store: string, code: string) => Promise<void>;
  /** Device: unpairs this tablet. User: just leaves the screen. */
  signOut: () => Promise<void>;
}

const KdsSessionContext = createContext<KdsSessionValue | null>(null);

/** sessionStorage flag: the pairing page shows "Dispositivo desvinculado" once. */
export const KDS_REVOKED_KEY = 'kds:revoked';

/**
 * Who is using the kitchen screen (D028): a paired device (credential in an httpOnly cookie,
 * exchanged for short access tokens) or a signed-in user with `kds:operate`. The device token
 * takes precedence on this tab, so the user session check never wipes it.
 */
export function KdsSessionProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [device, setDevice] = useState<KdsDeviceSessionDto | null | undefined>(undefined);

  const renew = useCallback(async (): Promise<boolean> => {
    try {
      const session = await renewDeviceSession();
      setDeviceSession(session.accessToken, renew);
      setDevice(session);
      return true;
    } catch {
      setDeviceSession(null);
      setDevice(null);
      return false;
    }
  }, []);

  useEffect(() => {
    void renew();
  }, [renew]);

  // Renew the device token shortly before it expires.
  useEffect(() => {
    if (!device) return;
    const timer = setTimeout(() => void renew(), Math.max(30_000, (device.expiresIn - 60) * 1000));
    return () => clearTimeout(timer);
  }, [device, renew]);

  const pair = useCallback(
    async (store: string, code: string) => {
      const session = await pairDevice(store, code);
      setDeviceSession(session.accessToken, renew);
      queryClient.removeQueries({ queryKey: kdsKeys.all });
      setDevice(session);
    },
    [queryClient, renew],
  );

  const signOut = useCallback(async () => {
    if (device) await unpairDevice();
    setDeviceSession(null);
    setDevice(null);
    queryClient.removeQueries({ queryKey: kdsKeys.all });
  }, [device, queryClient]);

  const { status, session, can } = auth;
  const value = useMemo<KdsSessionValue>(() => {
    const mode: KdsMode =
      device === undefined
        ? { kind: 'loading' }
        : device
          ? { kind: 'device', session: device }
          : status === 'loading'
            ? { kind: 'loading' }
            : status === 'authenticated' && can(Permission.KDS_OPERATE)
              ? { kind: 'user' }
              : { kind: 'none' };
    return {
      mode,
      storeName: device?.store.name ?? session?.store.tradeName ?? null,
      pair,
      signOut,
    };
  }, [device, status, session, can, pair, signOut]);

  return <KdsSessionContext.Provider value={value}>{children}</KdsSessionContext.Provider>;
}

export function useKdsSession(): KdsSessionValue {
  const ctx = useContext(KdsSessionContext);
  if (!ctx) throw new Error('useKdsSession must be used inside <KdsSessionProvider>');
  return ctx;
}

export type KdsRealtimeStatus = 'connecting' | 'online' | 'offline';

/**
 * Realtime for the kitchen screen: any order change refetches the board (debounced);
 * a reconnection refetches everything; a revoked device signs out. One socket, cleaned up
 * on unmount (the screen stays open all day: no listeners or timers pile up).
 */
export function useKdsRealtime(options: {
  enabled: boolean;
  isDevice: boolean;
  onRevoked: () => void;
}): KdsRealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<KdsRealtimeStatus>('connecting');
  const revoked = useRef(options.onRevoked);
  revoked.current = options.onRevoked;
  const { enabled, isDevice } = options;

  useEffect(() => {
    if (!enabled) return;
    const socket: Socket = io(`${API_URL}/realtime`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    });
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void queryClient.invalidateQueries({ queryKey: kdsKeys.all });
      }, 250);
    };
    const reconnect = async () => {
      setStatus('connecting');
      if (isDevice)
        await renewDeviceSession()
          .then((s) => setDeviceSession(s.accessToken))
          .catch(() => undefined);
      else await refreshSession();
      if (!socket.connected) socket.connect();
    };

    let hadConnection = false;
    socket.on('ready', () => {
      setStatus('online');
      if (hadConnection) refetch();
      hadConnection = true;
    });
    socket.on('auth_error', () => void reconnect());
    socket.on('disconnect', (reason) => {
      setStatus('offline');
      if (reason === 'io server disconnect') void reconnect();
    });
    socket.on('connect_error', () => setStatus('offline'));
    socket.on(REALTIME_EVENTS.ORDER_CREATED, refetch);
    socket.on(REALTIME_EVENTS.ORDER_UPDATED, refetch);
    socket.on(REALTIME_EVENTS.DEVICE_REVOKED, () => revoked.current());

    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      if (debounce) clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, isDevice, queryClient]);

  return status;
}
