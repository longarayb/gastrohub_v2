import { describe, expect, it } from 'vitest';
import {
  POSITION_STORE_SECONDS,
  SIGNAL_STALE_SECONDS,
  isUsablePosition,
  shouldStorePosition,
  signalLostMinutes,
} from './tracking.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, seconds)).toISOString();
const here = { latitude: -23.5649, longitude: -46.6519 };
/** ~111 m north per 0.001° of latitude. */
const north = (meters: number) => ({ ...here, latitude: here.latitude + meters / 111_200 });

describe('courier location sharing', () => {
  it('stores the first position, then only after moving or after some time', () => {
    const first = { ...here, recordedAt: at(0) };
    expect(shouldStorePosition(null, first)).toBe(true);
    // Stopped at a traffic light: not stored until the time passes.
    expect(shouldStorePosition(first, { ...here, recordedAt: at(5) })).toBe(false);
    expect(shouldStorePosition(first, { ...here, recordedAt: at(POSITION_STORE_SECONDS) })).toBe(
      true,
    );
    // Moving: stored even before the time.
    expect(shouldStorePosition(first, { ...north(40), recordedAt: at(5) })).toBe(true);
    expect(shouldStorePosition(first, { ...north(10), recordedAt: at(5) })).toBe(false);
  });

  it('ignores positions out of order and imprecise ones', () => {
    const last = { ...here, recordedAt: at(30) };
    expect(shouldStorePosition(last, { ...north(500), recordedAt: at(20) })).toBe(false);
    expect(isUsablePosition({ ...here, recordedAt: at(0), accuracyMeters: 25 })).toBe(true);
    expect(isUsablePosition({ ...here, recordedAt: at(0), accuracyMeters: 1500 })).toBe(false);
    expect(isUsablePosition({ ...here, recordedAt: at(0) })).toBe(true);
  });

  it('signal lost after two minutes without a position', () => {
    const now = new Date(at(0));
    expect(signalLostMinutes(null, now)).toBeNull();
    expect(signalLostMinutes(new Date(now.getTime() - 60_000), now)).toBeNull();
    expect(signalLostMinutes(new Date(now.getTime() - SIGNAL_STALE_SECONDS * 1000), now)).toBe(2);
    expect(signalLostMinutes(new Date(now.getTime() - 7.5 * 60_000), now)).toBe(7);
  });
});
