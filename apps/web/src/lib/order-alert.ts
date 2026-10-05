'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const REPEAT_MS = 10_000;
const STORAGE_KEY = 'order-alert-sound';

/** Short two-tone chime with WebAudio (no audio file to ship or cache). */
export function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  }
}

/**
 * Alert for new orders waiting for acceptance: plays a chime (repeating every few seconds)
 * and blinks the tab title while there are PENDING orders nobody opened yet.
 * Browsers only allow audio after a user gesture, hence the "Ativar som" button (`enable`).
 */
export function useOrderAlert(pendingIds: readonly string[]) {
  const audio = useRef<AudioContext | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try {
      setWanted(localStorage.getItem(STORAGE_KEY) === 'on');
    } catch {
      // Storage unavailable: the user enables the sound on each visit.
    }
  }, []);

  const unseen = useMemo(() => pendingIds.filter((id) => !seen.has(id)), [pendingIds, seen]);

  const enable = useCallback(() => {
    const ctx = audio.current ?? new AudioContext();
    audio.current = ctx;
    void ctx.resume().then(() => {
      setSoundOn(true);
      chime(ctx);
    });
    try {
      localStorage.setItem(STORAGE_KEY, 'on');
    } catch {
      // ignore
    }
  }, []);

  const disable = useCallback(() => {
    setSoundOn(false);
    setWanted(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // Chime now and every few seconds while there are unseen pending orders.
  const unseenKey = unseen.join(',');
  useEffect(() => {
    const ctx = audio.current;
    if (!soundOn || !ctx || !unseenKey) return;
    chime(ctx);
    const timer = setInterval(() => chime(ctx), REPEAT_MS);
    return () => clearInterval(timer);
  }, [soundOn, unseenKey]);

  // Blink the tab title.
  const count = unseen.length;
  useEffect(() => {
    if (!count) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? `(${count}) Novo pedido!` : original;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [count]);

  return {
    /** Sound active in this tab. */
    soundOn,
    /** The user enabled the sound before; the browser still needs one click to resume it. */
    needsGesture: wanted && !soundOn,
    enable,
    disable,
    unseenCount: count,
    /** Pending orders not opened yet (highlighted on the board). */
    unseen,
    markSeen,
  };
}
