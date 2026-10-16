import type { CourierAppDto, PositionsAcceptedDto } from '@app/shared';
import * as Crypto from 'expo-crypto';
import { ApiError, SessionEndedError, api } from './api';
import {
  type QueueState,
  type QueuedAction,
  type QueuedPosition,
  type SendResult,
  addAction,
  addPositions,
  classifyStatus,
  flushQueue,
} from './queue';
import { storage } from './storage';

/** The courier's route and the offline queue (D050). */
export const fetchRoute = () => api<CourierAppDto>('/courier/me');

// Every change to the stored queue goes through this chain (screens and the location task).
let chain: Promise<unknown> = Promise.resolve();
function mutateQueue(fn: (state: QueueState) => QueueState): Promise<QueueState> {
  const next = chain.then(async () => {
    const state = fn(await storage.getQueue());
    await storage.setQueue(state);
    return state;
  });
  chain = next.catch(() => undefined);
  return next;
}

export const readQueue = () => storage.getQueue();

export function newAction(
  kind: QueuedAction['kind'],
  stopId: string | null,
  body: Record<string, unknown>,
  label: string,
): QueuedAction {
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return {
    id,
    kind,
    stopId,
    // The server applies an action id once and keeps the time it happened on the phone.
    body: kind === 'return' ? body : { ...body, actionId: id, occurredAt: createdAt },
    createdAt,
    label,
  };
}

export const queueAction = (action: QueuedAction) => mutateQueue((s) => addAction(s, action));
export const queuePositions = (positions: QueuedPosition[]) =>
  mutateQueue((s) => addPositions(s, positions));

const pathOf = (a: QueuedAction) =>
  a.kind === 'return' ? '/courier/return' : `/courier/stops/${a.stopId}/${a.kind}`;

function resultOf(error: unknown): SendResult {
  if (error instanceof SessionEndedError) return { ok: false, retry: true };
  if (error instanceof ApiError) {
    if (error.status === 0 || classifyStatus(error.status) === 'retry') {
      return { ok: false, retry: true };
    }
    return { ok: false, retry: false, message: error.message };
  }
  return { ok: false, retry: true };
}

export interface FlushOutcome {
  refused: { label: string; message: string }[];
  offline: boolean;
  /** Stops still to deliver, from the last position sent (null when no position went out). */
  pendingStops: number | null;
  /** The server says there is no open run (the route ended at the store). */
  noRun: boolean;
  route: CourierAppDto | null;
}

let flushing: Promise<FlushOutcome> | null = null;

/** Sends what is waiting. One at a time; the queue keeps whatever could not go. */
export function flush(): Promise<FlushOutcome> {
  flushing ??= (async () => {
    try {
      const snapshot = await storage.getQueue();
      let pendingStops: number | null = null;
      let noRun = false;
      let route: CourierAppDto | null = null;
      const result = await flushQueue(snapshot, {
        action: async (a) => {
          try {
            route = await api<CourierAppDto>(pathOf(a), { method: 'POST', body: a.body });
            return { ok: true };
          } catch (error) {
            // "Voltei" already registered (the answer was lost): done.
            if (a.kind === 'return' && error instanceof ApiError && error.status === 400) {
              return { ok: true };
            }
            return resultOf(error);
          }
        },
        positions: async (batch) => {
          try {
            const res = await api<PositionsAcceptedDto>('/courier/positions', {
              method: 'POST',
              body: { positions: batch },
            });
            pendingStops = res.pendingStops;
            return { ok: true };
          } catch (error) {
            if (error instanceof ApiError && error.status === 400) noRun = true;
            return resultOf(error);
          }
        },
      });
      // Removes only what went out (new positions may have arrived meanwhile).
      const doneActions = new Set(
        snapshot.actions
          .slice(0, snapshot.actions.length - result.state.actions.length)
          .map((a) => a.id),
      );
      const donePositions = new Set(
        snapshot.positions
          .slice(0, snapshot.positions.length - result.state.positions.length)
          .map((p) => p.recordedAt),
      );
      await mutateQueue((s) => ({
        actions: s.actions.filter((a) => !doneActions.has(a.id)),
        positions: s.positions.filter((p) => !donePositions.has(p.recordedAt)),
      }));
      return {
        refused: result.refused.map((r) => ({ label: r.action.label, message: r.message })),
        offline: result.offline,
        pendingStops,
        noRun,
        route,
      };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
