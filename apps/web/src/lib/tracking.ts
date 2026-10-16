'use client';

import {
  type CourierPositionsInput,
  type CourierTrackingDto,
  type GeoPointDto,
  POSITION_SEND_SECONDS,
  type PositionsAcceptedDto,
  TRACKING_CONSENT_VERSION,
} from '@app/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from './api';

export const acceptTracking = () =>
  apiPost<CourierTrackingDto>('/courier/tracking/consent', { version: TRACKING_CONSENT_VERSION });

const sendPositions = (positions: CourierPositionsInput['positions']) =>
  apiPost<PositionsAcceptedDto>('/courier/positions', { positions });

/** The courier left it on: reopening the page during the route turns it back on. */
const PREFERENCE_KEY = 'courier-tracking-on';
const readPreference = () => {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
};
const savePreference = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PREFERENCE_KEY, '1');
    else localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    // Private window: the courier turns it on again next time.
  }
};

export type TrackingStatus =
  | 'off'
  | 'starting'
  | 'on'
  /** The location permission was refused (browser or phone settings). */
  | 'denied'
  /** The page is not https (GPS needs a secure address). */
  | 'insecure'
  | 'unsupported';

const MAX_BUFFER = 30;

/**
 * Location sharing of /entregas (D049): GPS while the page is open (and the screen on, kept by
 * the Wake Lock when the phone allows), one position every few seconds to the API, kept in a
 * small buffer while the network drops. Stops by itself when the run ends.
 */
export function useCourierTracking(runId: string | null) {
  const [status, setStatus] = useState<TrackingStatus>('off');
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [position, setPosition] = useState<GeoPointDto | null>(null);
  const [screenOn, setScreenOn] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const buffer = useRef<CourierPositionsInput['positions']>([]);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    if (sending.current || !buffer.current.length) return;
    sending.current = true;
    const batch = buffer.current.splice(0, MAX_BUFFER);
    try {
      await sendPositions(batch);
      setLastSentAt(new Date());
      setSendError(null);
    } catch (error) {
      // No network: keep the latest ones for the next try (the oldest are dropped).
      if (!(error instanceof ApiError) || error.status >= 500) {
        buffer.current = [...batch, ...buffer.current].slice(-MAX_BUFFER);
      }
      setSendError(error instanceof ApiError ? error.message : 'Sem conexão: tentando de novo');
    } finally {
      sending.current = false;
    }
  }, []);

  const keepScreenOn = useCallback(async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLock.current = await navigator.wakeLock.request('screen');
      setScreenOn(true);
      wakeLock.current.addEventListener('release', () => setScreenOn(false));
    } catch {
      setScreenOn(false);
    }
  }, []);

  const stop = useCallback(
    (remember = true) => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      void flush();
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      if (remember) savePreference(false);
      setStatus('off');
    },
    [flush],
  );

  const start = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setStatus('insecure');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    if (watchId.current != null) return;
    setStatus('starting');
    savePreference(true);
    watchId.current = navigator.geolocation.watchPosition(
      (fix) => {
        setStatus('on');
        const point = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        setPosition(point);
        buffer.current = [
          ...buffer.current,
          {
            ...point,
            accuracyMeters: fix.coords.accuracy ?? null,
            speedMps: fix.coords.speed ?? null,
            heading:
              fix.coords.heading != null && !Number.isNaN(fix.coords.heading)
                ? fix.coords.heading
                : null,
            recordedAt: new Date(fix.timestamp).toISOString(),
          },
        ].slice(-MAX_BUFFER);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          stop(true);
          setStatus('denied');
        }
        // Timeouts and no fix: keep watching (tunnels, indoors).
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    timer.current = setInterval(() => void flush(), POSITION_SEND_SECONDS * 1000);
    void keepScreenOn();
  }, [flush, keepScreenOn, stop]);

  // The screen lock is released when the page goes to the background: take it again on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && watchId.current != null) {
        void keepScreenOn();
        void flush();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [flush, keepScreenOn]);

  // No open run: nothing is sent. Reopening the page during the route resumes if it was on.
  useEffect(() => {
    if (!runId) {
      if (watchId.current != null) stop(false);
      return;
    }
    if (readPreference() && watchId.current == null) start();
  }, [runId, start, stop]);

  useEffect(() => () => stop(false), [stop]);

  return { status, start, stop: () => stop(true), lastSentAt, position, screenOn, sendError };
}
