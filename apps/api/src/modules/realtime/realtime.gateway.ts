import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { type AccessTokenPayload, KDS_DEVICE_ROLE, PRINT_AGENT_ROLE } from '@app/shared';
import type { Server, Socket } from 'socket.io';
import { AppConfig } from '../../core/config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';

export const tenantRoom = (tenantId: string) => `tenant:${tenantId}`;
/** A paired KDS screen (revocation notice). */
export const deviceRoom = (deviceId: string) => `device:${deviceId}`;
/** A paired print agent: job nudges and revocation. Agents never join the tenant room. */
export const printAgentRoom = (agentId: string) => `print-agent:${agentId}`;
export const sectorRoom = (tenantId: string, sectorId: string) =>
  `tenant:${tenantId}:sector:${sectorId}`;

interface SocketData {
  user: AccessTokenPayload;
}

/**
 * Authenticated realtime channel. The access token goes in the handshake
 * (`auth: { token }`); invalid tokens are rejected and sockets are disconnected when the
 * token expires, so clients reconnect with a refreshed token. Events are notifications
 * only: clients refetch state on reconnect (events may be lost).
 */
// CORS is configured by the IO adapter with the same origins as the HTTP API.
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth as { token?: string } | undefined)?.token ??
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload & { exp: number }>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      if (payload.role === KDS_DEVICE_ROLE) {
        const active = await this.prisma.kdsDevice.count({
          where: { id: payload.sub, tenantId: payload.tenantId, revokedAt: null },
        });
        if (!active) throw new Error('revoked device');
        await client.join(deviceRoom(payload.sub));
      }
      (client.data as SocketData).user = payload;
      if (payload.role === PRINT_AGENT_ROLE) {
        // Print agents only get "new jobs" nudges in their own room (no order data).
        const active = await this.prisma.printAgent.count({
          where: { id: payload.sub, tenantId: payload.tenantId, revokedAt: null },
        });
        if (!active) throw new Error('revoked agent');
        await client.join(printAgentRoom(payload.sub));
      } else {
        await client.join(tenantRoom(payload.tenantId));
      }
      // Force a reconnect (with a refreshed token) when this one expires.
      const ms = payload.exp * 1000 - Date.now();
      const timer = setTimeout(() => client.disconnect(true), Math.max(ms, 0));
      client.once('disconnect', () => clearTimeout(timer));
      client.emit('ready', { tenantId: payload.tenantId });
    } catch {
      client.emit('auth_error', { message: 'Sessão inválida ou expirada' });
      client.disconnect(true);
    }
  }

  /** KDS screens subscribe to the sectors they display. */
  @SubscribeMessage('subscribe:sector')
  async subscribeSector(@ConnectedSocket() client: Socket, @MessageBody() sectorId: string) {
    const user = (client.data as SocketData).user;
    if (!user || user.role === PRINT_AGENT_ROLE || typeof sectorId !== 'string')
      return { ok: false };
    await client.join(sectorRoom(user.tenantId, sectorId));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:sector')
  async unsubscribeSector(@ConnectedSocket() client: Socket, @MessageBody() sectorId: string) {
    const user = (client.data as SocketData).user;
    if (!user || typeof sectorId !== 'string') return { ok: false };
    await client.leave(sectorRoom(user.tenantId, sectorId));
    return { ok: true };
  }

  emit(room: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(room).emit(event, payload);
    this.logger.debug({ room, event }, 'realtime emit');
  }
}
