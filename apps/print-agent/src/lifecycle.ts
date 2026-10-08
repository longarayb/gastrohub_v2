import type { Server } from 'node:http';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another account.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Exits when the parent process disappears. Under the Windows service the parent is WinSW: if it
 * is killed, the agent must not stay behind as an orphan (it would hold the local page port and,
 * once Windows restarts the service, two agents would print the same jobs).
 */
export function watchParent(
  onGone: () => void,
  options: { ppid?: number; everyMs?: number; isAlive?: (pid: number) => boolean } = {},
): () => void {
  const ppid = options.ppid ?? process.ppid;
  const isAlive = options.isAlive ?? alive;
  if (!ppid || ppid <= 1) return () => {};
  const timer = setInterval(() => {
    if (!isAlive(ppid)) {
      clearInterval(timer);
      onGone();
    }
  }, options.everyMs ?? 2000);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Starts a server, retrying while the port is taken (an old instance still shutting down after
 * a restart). Other errors, or a port still busy at the end, are thrown.
 */
export async function listenWithRetry(
  start: () => Promise<Server>,
  options: { attempts?: number; delayMs?: number; onRetry?: (attempt: number) => void } = {},
): Promise<Server> {
  const attempts = options.attempts ?? 20;
  for (let attempt = 1; ; attempt++) {
    try {
      return await start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= attempts) {
        throw error;
      }
      options.onRetry?.(attempt);
      await new Promise((r) => setTimeout(r, options.delayMs ?? 3000));
    }
  }
}
