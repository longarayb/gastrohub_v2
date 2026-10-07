import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../core/prisma/prisma.service.js';

export const trackingRoom = (token: string) => `tracking:${token}`;

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Public tracking channel of the digital menu (D034): no login, the socket joins only the room
 * of its own unguessable tracking token and receives `{ status, version }` notifications
 * (the page refetches the public tracking endpoint; no personal data goes through here).
 */
@WebSocketGateway({ namespace: '/tracking' })
export class TrackingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !TOKEN.test(token)) {
      client.disconnect(true);
      return;
    }
    // Raw client: the token itself identifies the order (unique across stores).
    const exists = await this.prisma.order.count({ where: { trackingToken: token } });
    if (!exists) {
      client.disconnect(true);
      return;
    }
    await client.join(trackingRoom(token));
    client.emit('ready', {});
  }

  emit(token: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(trackingRoom(token)).emit(event, payload);
    this.logger.debug({ event }, 'tracking emit');
  }
}
