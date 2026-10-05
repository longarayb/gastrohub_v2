import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub (events reach clients on any API instance),
 * with the same CORS origins as the HTTP API.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];
  private closing?: Promise<void>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  connectToRedis(): void {
    const pub = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    this.clients = [pub, sub];
    this.adapterConstructor = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    } as ServerOptions);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  /**
   * Nest calls this once per gateway server entry (the root server and each namespace share
   * the same Socket.IO server), concurrently. Closing the server makes the Redis adapter send
   * UNSUBSCRIBE without awaiting it; quitting the clients more than once rejects those pending
   * commands as unhandled "Connection is closed" errors. So the shutdown runs only once.
   */
  override close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    this.closing ??= (async () => {
      await super.close(server);
      await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
    })();
    return this.closing;
  }
}
