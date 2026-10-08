import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenWithRetry, watchParent } from './lifecycle.js';

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const listen = (port: number) =>
  new Promise<Server>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      servers.push(server);
      resolve(server);
    });
  });

describe('agent lifecycle', () => {
  it('exits when the service process (parent) is gone', async () => {
    let alive = true;
    const onGone = vi.fn();
    watchParent(onGone, { ppid: 4242, everyMs: 10, isAlive: () => alive });
    await new Promise((r) => setTimeout(r, 40));
    expect(onGone).not.toHaveBeenCalled();
    alive = false;
    await new Promise((r) => setTimeout(r, 40));
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('waits for the port of an old instance instead of crashing', async () => {
    const old = await listen(0);
    const port = (old.address() as AddressInfo).port;
    const retries: number[] = [];
    const pending = listenWithRetry(() => listen(port), {
      delayMs: 20,
      onRetry: (n) => {
        retries.push(n);
        if (n === 2) old.close();
      },
    });
    const server = await pending;
    expect((server.address() as AddressInfo).port).toBe(port);
    expect(retries).toEqual([1, 2]);
  });

  it('gives up after the attempts (and on other errors)', async () => {
    const old = await listen(0);
    const port = (old.address() as AddressInfo).port;
    await expect(
      listenWithRetry(() => listen(port), { attempts: 2, delayMs: 5 }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const boom = Object.assign(new Error('x'), { code: 'EACCES' });
    await expect(listenWithRetry(() => Promise.reject(boom), { delayMs: 5 })).rejects.toBe(boom);
  });
});
