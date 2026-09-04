import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma/prisma.service';

export const BOARD_EVENTS = {
  taskCreated: 'task.created',
  taskUpdated: 'task.updated',
  taskMoved: 'task.moved',
  taskDeleted: 'task.deleted',
  columnCreated: 'column.created',
  columnUpdated: 'column.updated',
  columnMoved: 'column.moved',
  columnDeleted: 'column.deleted',
} as const;

const room = (boardId: string) => `board:${boardId}`;

/**
 * Single-instance Socket.IO gateway (PLAN §3). Rooms are in-memory — correct
 * for one backend container; the Redis adapter for cross-instance pub/sub is
 * PLAN §7, deliberately not built here.
 *
 * Two separate authorization steps, on purpose:
 *  1. **Connection** — the handshake carries a ws-ticket (Phase 4), not the
 *     access token: `mk_at` is httpOnly so browser JS can't read it to pass
 *     into `io(url, { auth })`, and a WS upgrade to a different origin
 *     wouldn't carry a `SameSite=Lax` cookie anyway. The ticket is single-use
 *     and expires in ~30s.
 *  2. **Joining a board room** — re-runs the same `BoardMember` lookup
 *     `BoardAccessGuard` does (PLAN §3/§4 hardening). A valid session is not
 *     authority to *listen* to a board; without this re-check, anyone with an
 *     account could subscribe to any board's live updates.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class BoardGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(BoardGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Ticket validation runs as Socket.IO middleware so it happens *during*
   * the handshake: an unauthenticated socket is never admitted, not even
   * briefly, and the client sees a normal `connect_error` instead of
   * connecting and then being kicked.
   */
  afterInit(server: Server): void {
    server.use((client: Socket, next: (err?: Error) => void) => {
      const ticket = client.handshake?.auth?.ticket;
      const userId =
        typeof ticket === 'string'
          ? this.authService.consumeWsTicket(ticket)
          : null;
      if (!userId) {
        // One opaque reason — never leak whether the ticket was missing,
        // expired, or already spent.
        next(new Error('INVALID_TICKET'));
        return;
      }
      client.data.userId = userId;
      next();
    });
  }

  /** Belt-and-braces: nothing without an identity ever stays connected. */
  handleConnection(client: Socket): void {
    if (!client.data?.userId) {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: string },
  ) {
    const userId = client.data?.userId as string | undefined;
    const boardId = body?.boardId;
    if (!userId || !boardId) {
      return { error: 'FORBIDDEN' };
    }

    const membership = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { role: true },
    });
    if (!membership) {
      // Same shape whether the board doesn't exist or isn't shared with this
      // caller — the REST guard makes the same choice (no existence oracle).
      return { error: 'FORBIDDEN' };
    }

    await client.join(room(boardId));
    return { ok: true, boardId, role: membership.role };
  }

  @SubscribeMessage('leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: string },
  ) {
    if (body?.boardId) {
      await client.leave(room(body.boardId));
    }
    return { ok: true };
  }

  /**
   * Fire-and-forget broadcast to everyone currently watching a board. Always
   * called *after* the database work has committed, never inside a
   * transaction — an event that announces a write that later rolls back is
   * worse than no event at all.
   */
  emit(boardId: string, event: string, payload: unknown): void {
    // The gateway may not be initialized in unit tests / before the HTTP
    // server is listening; a missed broadcast must never break a REST write.
    if (!this.server) {
      return;
    }
    try {
      this.server.to(room(boardId)).emit(event, payload);
    } catch (err) {
      this.logger.warn(`Failed to emit ${event} for board ${boardId}: ${err}`);
    }
  }
}
