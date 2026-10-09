'use client';

import { type OrderEvent, REALTIME_EVENTS } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';
import { useAuth } from './auth';
import { cashKeys } from './cash';
import { deliveryKeys } from './delivery';
import { orderKeys } from './orders';
import { printKeys } from './printing';
import { reportKeys } from './reports';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

type Listener = (event: OrderEvent) => void;

interface RealtimeContextValue {
  status: RealtimeStatus;
  /** Subscribes to order.created events (sound alert, toasts). Returns the unsubscribe. */
  onOrderCreated: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * One Socket.IO connection per signed-in session (namespace /realtime, rooms per unit).
 * Events are notifications: on each one the affected queries are refetched from the API.
 * After a reconnection or when the window regains focus everything is refetched, so
 * events missed while offline are never lost.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const listeners = useRef(new Set<Listener>());
  const socketRef = useRef<Socket | null>(null);
  const storeId = session?.store.id ?? null;
  const token = session?.accessToken ?? null;

  // Connect once per store (switching store = new tenant room).
  useEffect(() => {
    if (!storeId) return;
    const socket = io(`${API_URL}/realtime`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;
    let hadConnection = false;

    // The dashboard recomputes the day: a burst of order events refreshes it once.
    let reportsTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshReports = () => {
      if (reportsTimer) return;
      reportsTimer = setTimeout(() => {
        reportsTimer = null;
        void queryClient.invalidateQueries({ queryKey: [...reportKeys.all, 'day'] });
      }, 2000);
    };
    const refetchAll = () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.tables });
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      refreshReports();
    };
    // Server-side disconnects (expired token) are not retried automatically.
    const reconnectWithFreshToken = async () => {
      setStatus('connecting');
      await refreshSession();
      if (!socket.connected) socket.connect();
    };

    socket.on('ready', () => {
      setStatus('online');
      if (hadConnection) refetchAll();
      hadConnection = true;
    });
    socket.on('auth_error', () => void reconnectWithFreshToken());
    socket.on('disconnect', (reason) => {
      setStatus('offline');
      if (reason === 'io server disconnect') void reconnectWithFreshToken();
    });
    socket.on('connect_error', () => setStatus('offline'));

    socket.on(REALTIME_EVENTS.ORDER_CREATED, (event: OrderEvent) => {
      refetchAll();
      for (const listener of listeners.current) listener(event);
    });
    socket.on(REALTIME_EVENTS.ORDER_UPDATED, (event: OrderEvent) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.board });
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(event.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.tables });
      void queryClient.invalidateQueries({ queryKey: cashKeys.receivables });
      refreshReports();
    });
    socket.on(REALTIME_EVENTS.CASH_UPDATED, () => {
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
    });
    // Routes, courier balances, settlements and areas (also the courier app).
    socket.on(REALTIME_EVENTS.DELIVERY_UPDATED, () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    });
    // Agents, printers or the print queue (alerts badge, settings screen).
    socket.on(REALTIME_EVENTS.PRINTING_UPDATED, () => {
      void queryClient.invalidateQueries({ queryKey: printKeys.all });
    });
    socket.on(REALTIME_EVENTS.TABLES_UPDATED, () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.tables });
    });

    const onFocus = () => {
      if (document.visibilityState === 'visible') refetchAll();
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onFocus);
      if (reportsTimer) clearTimeout(reportsTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [storeId, queryClient]);

  // A renewed access token is picked up on the next (re)connection via the auth callback;
  // if the socket dropped meanwhile, reconnect right away.
  useEffect(() => {
    const socket = socketRef.current;
    if (token && socket && !socket.connected && !socket.active) socket.connect();
  }, [token]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      onOrderCreated: (listener) => {
        listeners.current.add(listener);
        return () => void listeners.current.delete(listener);
      },
    }),
    [status],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return ctx;
}
