/**
 * Offline queue of the courier app (D050): actions ("Entregue", "Não entregue", "Voltei") and
 * positions wait on the phone while there is no signal and go out in order when it comes back.
 * Every action carries an id: the server answers a resend of an applied action as done, so
 * nothing is applied twice. Pure logic (storage and network come from outside, tested).
 */

export type QueuedActionKind = 'deliver' | 'fail' | 'return';

export interface QueuedAction {
  id: string;
  kind: QueuedActionKind;
  stopId: string | null;
  /** Body sent to the API (already with actionId and occurredAt). */
  body: Record<string, unknown>;
  createdAt: string;
  /** Label shown in "Aguardando sinal" (e.g. "Entregue #12"). */
  label: string;
}

export interface QueuedPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  heading: number | null;
  recordedAt: string;
}

export interface QueueState {
  actions: QueuedAction[];
  positions: QueuedPosition[];
}

/** The oldest positions are dropped beyond this (a long tunnel: the latest ones matter). */
export const MAX_POSITIONS = 300;
/** Positions sent per request (the API takes up to 30). */
export const POSITIONS_PER_SEND = 30;

export const emptyQueue = (): QueueState => ({ actions: [], positions: [] });

export function addAction(state: QueueState, action: QueuedAction): QueueState {
  if (state.actions.some((a) => a.id === action.id)) return state;
  return { ...state, actions: [...state.actions, action] };
}

export function addPositions(state: QueueState, positions: QueuedPosition[]): QueueState {
  const all = [...state.positions, ...positions].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
  return { ...state, positions: all.slice(-MAX_POSITIONS) };
}

/** What happened to one send: done, try again later (no signal, server down) or refused. */
export type SendResult =
  { ok: true } | { ok: false; retry: true } | { ok: false; retry: false; message: string };

export interface FlushResult {
  state: QueueState;
  /** Actions the server refused (shown to the courier; they leave the queue). */
  refused: { action: QueuedAction; message: string }[];
  sentActions: number;
  sentPositions: number;
  /** Stopped because there is no connection: the rest waits. */
  offline: boolean;
}

/**
 * Sends the actions first, in the order they happened (a "Voltei" never goes before the last
 * "Entregue"), then the positions in batches. Stops at the first send that must be retried.
 */
export async function flushQueue(
  state: QueueState,
  send: {
    action: (action: QueuedAction) => Promise<SendResult>;
    positions: (batch: QueuedPosition[]) => Promise<SendResult>;
  },
): Promise<FlushResult> {
  let current = state;
  const refused: FlushResult['refused'] = [];
  let sentActions = 0;
  let sentPositions = 0;
  while (current.actions.length) {
    const action = current.actions[0]!;
    const result = await send.action(action);
    if (!result.ok && result.retry) {
      return { state: current, refused, sentActions, sentPositions, offline: true };
    }
    if (!result.ok) refused.push({ action, message: result.message });
    else sentActions++;
    current = { ...current, actions: current.actions.slice(1) };
  }
  while (current.positions.length) {
    const batch = current.positions.slice(0, POSITIONS_PER_SEND);
    const result = await send.positions(batch);
    if (!result.ok && result.retry) {
      return { state: current, refused, sentActions, sentPositions, offline: true };
    }
    // Refused positions (run closed, consent changed) are dropped: they would never be accepted.
    if (result.ok) sentPositions += batch.length;
    current = { ...current, positions: current.positions.slice(batch.length) };
  }
  return { state: current, refused, sentActions, sentPositions, offline: false };
}

/** Status code → retry later or refuse (4xx means the server decided; 408/429/5xx are temporary). */
export function classifyStatus(status: number): 'retry' | 'refuse' {
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'refuse';
}
