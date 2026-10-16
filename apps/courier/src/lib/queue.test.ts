import { describe, expect, it } from 'vitest';
import {
  MAX_POSITIONS,
  type QueuedAction,
  type QueuedPosition,
  type SendResult,
  addAction,
  addPositions,
  classifyStatus,
  emptyQueue,
  flushQueue,
} from './queue';

const action = (id: string, kind: QueuedAction['kind'] = 'deliver'): QueuedAction => ({
  id,
  kind,
  stopId: kind === 'return' ? null : `stop-${id}`,
  body: { actionId: id },
  createdAt: '2026-10-16T12:00:00.000Z',
  label: id,
});
const position = (second: number): QueuedPosition => ({
  latitude: -23.56,
  longitude: -46.65,
  accuracyMeters: 10,
  speedMps: null,
  heading: null,
  recordedAt: new Date(Date.UTC(2026, 9, 16, 12, 0, second)).toISOString(),
});

describe('offline queue of the courier app', () => {
  it('keeps each action once and the positions in time order, up to a limit', () => {
    let state = addAction(emptyQueue(), action('a'));
    state = addAction(state, action('a'));
    expect(state.actions).toHaveLength(1);
    state = addPositions(state, [position(5), position(1)]);
    expect(state.positions.map((p) => p.recordedAt.slice(17, 19))).toEqual(['01', '05']);
    state = addPositions(
      state,
      Array.from({ length: MAX_POSITIONS + 10 }, (_, i) => position(10 + i)),
    );
    expect(state.positions).toHaveLength(MAX_POSITIONS);
    // The latest ones stay.
    expect(state.positions.at(-1)!.recordedAt).toBe(position(10 + MAX_POSITIONS + 9).recordedAt);
  });

  it('sends the actions in order, then the positions; without signal everything waits', async () => {
    let state = addAction(emptyQueue(), action('entregue'));
    state = addAction(state, action('voltei', 'return'));
    state = addPositions(state, [position(1), position(2)]);
    const sent: string[] = [];
    let online = false;
    const send = {
      action: async (a: QueuedAction): Promise<SendResult> => {
        if (!online) return { ok: false, retry: true };
        sent.push(a.id);
        return { ok: true };
      },
      positions: async (batch: QueuedPosition[]): Promise<SendResult> => {
        sent.push(`${batch.length} posições`);
        return { ok: true };
      },
    };
    const offline = await flushQueue(state, send);
    expect(offline.offline).toBe(true);
    expect(offline.state).toEqual(state);
    online = true;
    const done = await flushQueue(offline.state, send);
    expect(sent).toEqual(['entregue', 'voltei', '2 posições']);
    expect(done).toMatchObject({ offline: false, sentActions: 2, sentPositions: 2 });
    expect(done.state).toEqual(emptyQueue());
  });

  it('an action the server refuses leaves the queue and is reported; the next ones go on', async () => {
    let state = addAction(emptyQueue(), action('cancelado'));
    state = addAction(state, action('ok'));
    const result = await flushQueue(state, {
      action: async (a) =>
        a.id === 'cancelado'
          ? { ok: false, retry: false, message: 'Esta entrega já foi encerrada' }
          : { ok: true },
      positions: async () => ({ ok: true }),
    });
    expect(result.refused).toEqual([
      { action: state.actions[0], message: 'Esta entrega já foi encerrada' },
    ]);
    expect(result.sentActions).toBe(1);
    expect(result.state.actions).toEqual([]);
  });

  it('only timeouts, rate limits and server errors are retried', () => {
    expect(classifyStatus(400)).toBe('refuse');
    expect(classifyStatus(403)).toBe('refuse');
    expect(classifyStatus(409)).toBe('refuse');
    expect(classifyStatus(408)).toBe('retry');
    expect(classifyStatus(429)).toBe('retry');
    expect(classifyStatus(502)).toBe('retry');
  });
});
