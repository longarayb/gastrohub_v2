'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chime } from './order-alert';

/** Low descending tones: a canceled item must not sound like a new ticket. */
function cancelTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, freq] of [520, 330, 220].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const start = now + i * 0.22;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  }
}

/**
 * Kitchen screen sounds. Browsers only play audio after a user gesture, so the screen starts
 * with "Toque para iniciar" (`start`), which also enters full screen and keeps it awake.
 */
export function useKdsSound() {
  const ctx = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);

  const enable = useCallback(async () => {
    const audio = ctx.current ?? new AudioContext();
    ctx.current = audio;
    await audio.resume();
    setEnabled(audio.state === 'running');
    chime(audio);
  }, []);

  useEffect(
    () => () => {
      void ctx.current?.close();
      ctx.current = null;
    },
    [],
  );

  const play = useCallback((kind: 'new' | 'canceled') => {
    const audio = ctx.current;
    if (!audio || audio.state !== 'running') return;
    if (kind === 'new') chime(audio);
    else cancelTone(audio);
  }, []);

  return { enabled, enable, play };
}

/** Keeps the screen on while `active` (re-acquired when the tab becomes visible again). */
export function useWakeLock(active: boolean): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (disposed) {
          await sentinel.release();
          return;
        }
        setLocked(true);
        sentinel.addEventListener('release', () => setLocked(false), { once: true });
      } catch {
        setLocked(false); // not allowed (battery saver, insecure origin): the screen still works
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released))
        void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
  return locked;
}

export async function enterFullscreen(): Promise<void> {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  await document.documentElement.requestFullscreen().catch(() => undefined);
}

export async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  else await enterFullscreen();
}
