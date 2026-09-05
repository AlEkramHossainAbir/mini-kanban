import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BoardRole, Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { BOARD_EVENTS, BoardGateway } from '../gateway/board.gateway';
import { between, first, last } from '../tasks/rank.util';
import { decodeCursor, encodeCursor } from './cursor.util';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateBoardDto } from './dto/create-board.dto';
import { ListBoardsQueryDto } from './dto/list-boards-query.dto';
import { SearchMembersQueryDto } from './dto/search-members-query.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

const MEMBER_SELECT = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.BoardMemberSelect;

type MemberView = Prisma.BoardMemberGetPayload<{
  select: typeof MEMBER_SELECT;
}>;

/**
 * Columns a brand-new board opens with, in order. The brief only ever
 * requires that columns be *manageable* (create/rename/delete/reorder all
 * still work on these, they are ordinary rows with no special flag) — this
 * exists so a fresh board isn't an empty strip on first load. "Done" is
 * spelled exactly that way on purpose: the frontend derives a column's tab
 * colour and its cards' struck-through treatment from that literal title.
 */
const DEFAULT_COLUMN_TITLES = ['To Do', 'Done'] as const;

// Small and fixed on purpose: this backs a live-typing autocomplete, not a
// paginated directory — enough rows to be useful, few enough to never need
// a "load more".
const INVITE_CANDIDATE_LIMIT = 8;

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: BoardGateway,
  ) {}

  async create(ownerId: string, dto: CreateBoardDto) {
    // Single source of truth (PLAN §4): the OWNER membership row is created
    // in the same transaction as the board, never as a follow-up write —
    // there is no window where the board exists but nobody can access it.
    return this.prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: { title: dto.title, description: dto.description, ownerId },
      });
      await tx.boardMember.create({
        data: { boardId: board.id, userId: ownerId, role: BoardRole.OWNER },
      });
      // Seeded in the same transaction for the same reason as the membership
      // row: a board is never observable in a half-built state. Ranks are
      // computed the way ColumnsService.create computes them — successive
      // midpoints toward the max sentinel — so a later `POST /columns` files
      // itself after these without any special case.
      let rank = first();
      for (const title of DEFAULT_COLUMN_TITLES) {
        rank = between(rank, last());
        await tx.column.create({ data: { boardId: board.id, title, rank } });
      }
      return board;
    });
  }

  async list(userId: string, query: ListBoardsQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // Access is via BoardMember, not Board.ownerId (PLAN §2/§4) — this is a
    // join on the filter side, not a single-table scan.
    const rows = await this.prisma.board.findMany({
      where: {
        members: { some: { userId } },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // one extra row reveals whether there's a next page
      select: {
        id: true,
        title: true,
        description: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        members: { where: { userId }, select: { role: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map(({ members, ...board }) => ({
      ...board,
      role: members[0]?.role ?? null,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return { items, nextCursor };
  }

  async findOne(boardId: string, callerRole: BoardRole) {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        title: true,
        description: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        columns: {
          // Ranks can collide (rare, harmless by design — PLAN §3); the id
          // tiebreak is what keeps that deterministic instead of flapping
          // between requests.
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            boardId: true,
            title: true,
            rank: true,
            createdAt: true,
            updatedAt: true,
            tasks: {
              orderBy: [{ rank: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                columnId: true,
                boardId: true,
                title: true,
                description: true,
                rank: true,
                version: true, // load-bearing: the move API needs this (PLAN §3)
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    // BoardAccessGuard already proved membership before this ever runs — a
    // miss here only means the board was deleted in the gap between the
    // guard's check and this query. Rare, but handled rather than a 500.
    if (!board) {
      throw new NotFoundException();
    }
    return { ...board, role: callerRole };
  }

  update(boardId: string, dto: UpdateBoardDto) {
    return this.prisma.board.update({ where: { id: boardId }, data: dto });
  }

  async remove(boardId: string, actorId: string): Promise<void> {
    // Columns → tasks cascade via the FK onDelete: Cascade in the schema.
    const board = await this.prisma.board.delete({ where: { id: boardId } });
    // AuditLog.boardId is denormalized rather than a FK precisely so this
    // row outlives the board it describes (PLAN §2).
    await this.audit.log({
      userId: actorId,
      boardId,
      action: AuditAction.BOARD_DELETE,
      entityType: AuditEntity.BOARD,
      entityId: boardId,
      metadata: { title: board.title },
    });
  }

  listMembers(boardId: string) {
    return this.prisma.boardMember.findMany({
      where: { boardId },
      orderBy: { createdAt: 'asc' },
      select: MEMBER_SELECT,
    });
  }

  /**
   * Backs the invite field's autocomplete (`GET :boardId/members/candidates`,
   * OWNER-only — same gate as `addMember` itself, since this exists only to
   * feed that form). Registered users matching `q` against email or name,
   * excluding anyone already on the board — an invite-by-email flow can only
   * ever act on a non-member, so a member showing up in its own suggestion
   * list would just be a confusing dead end, not a real choice.
   *
   * Matches email/name are returned, `passwordHash` never selected — same
   * shape discipline as `PublicUser` elsewhere.
   */
  searchInviteCandidates(boardId: string, query: SearchMembersQueryDto) {
    const q = query.q?.trim();
    return this.prisma.user.findMany({
      where: {
        boardMembers: { none: { boardId } },
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { email: 'asc' },
      take: INVITE_CANDIDATE_LIMIT,
      select: { id: true, email: true, name: true },
    });
  }

  async addMember(boardId: string, dto: AddMemberDto, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Sharing only works with an already-registered user (PLAN §3) — no
    // pending-invite-by-email flow in the 4-day MVP scope.
    if (!user) {
      throw new NotFoundException('No registered user with that email');
    }

    let member: MemberView;
    try {
      member = await this.prisma.boardMember.create({
        data: { boardId, userId: user.id, role: dto.role },
        select: MEMBER_SELECT,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new ConflictException('User is already a member of this board');
      }
      throw err;
    }

    await this.audit.log({
      userId: actorId,
      boardId,
      action: AuditAction.BOARD_SHARE,
      entityType: AuditEntity.BOARD_MEMBER,
      entityId: user.id,
      metadata: { targetEmail: user.email, role: dto.role },
    });
    return member;
  }

  async updateMemberRole(
    boardId: string,
    userId: string,
    role: BoardRole,
    actorId: string,
  ) {
    const previous = await this.assertLastOwnerSafe(boardId, userId, role);

    let member: MemberView;
    try {
      member = await this.prisma.boardMember.update({
        where: { boardId_userId: { boardId, userId } },
        data: { role },
        select: MEMBER_SELECT,
      });
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        throw new NotFoundException('That user is not a member of this board');
      }
      throw err;
    }

    await this.audit.log({
      userId: actorId,
      boardId,
      action: AuditAction.ROLE_CHANGE,
      entityType: AuditEntity.BOARD_MEMBER,
      entityId: userId,
      metadata: { from: previous?.role ?? null, to: role },
    });
    // Broadcast after the write commits, same rule task/column events
    // follow — an event describing a change that later rolled back would be
    // worse than no event. Every connected client in the room gets this,
    // not just the affected user's socket: the frontend decides what to do
    // with it (the demoted user's own board view drops its edit affordances;
    // everyone else's member list just re-syncs the row).
    this.gateway.emit(boardId, BOARD_EVENTS.memberRoleChanged, {
      userId,
      role,
    });
    return member;
  }

  async removeMember(
    boardId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    const previous = await this.assertLastOwnerSafe(boardId, userId, null);
    try {
      await this.prisma.boardMember.delete({
        where: { boardId_userId: { boardId, userId } },
      });
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        throw new NotFoundException('That user is not a member of this board');
      }
      throw err;
    }

    await this.audit.log({
      userId: actorId,
      boardId,
      action: AuditAction.BOARD_UNSHARE,
      entityType: AuditEntity.BOARD_MEMBER,
      entityId: userId,
      metadata: { revokedRole: previous?.role ?? null },
    });
    // The removed user's own socket is still in `board:<boardId>` at this
    // point — nothing here kicks it out of the Socket.IO room, only tells
    // its board view to treat itself as no-longer-a-member (PLAN §4's guard
    // chain is what actually stops it acting on the board in the meantime).
    this.gateway.emit(boardId, BOARD_EVENTS.memberRemoved, { userId });
  }

  /**
   * A board can never end up ownerless (PLAN §4): rejects demoting a member
   * away from OWNER, or removing one (`newRole: null`), if they're the
   * board's last remaining OWNER.
   *
   * Returns the membership row as it stood *before* the caller's mutation,
   * so the audit entry can record what the role changed from — the target
   * row is gone or overwritten by the time the caller comes to log it.
   */
  private async assertLastOwnerSafe(
    boardId: string,
    userId: string,
    newRole: BoardRole | null,
  ): Promise<{ role: BoardRole } | null> {
    const target = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { role: true },
    });
    if (newRole === BoardRole.OWNER) {
      return target; // staying/becoming OWNER never reduces the owner count
    }
    if (!target || target.role !== BoardRole.OWNER) {
      return target; // wasn't an owner to begin with — nothing to protect
    }
    const ownerCount = await this.prisma.boardMember.count({
      where: { boardId, role: BoardRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new ConflictException(
        "Cannot remove or demote the board's last owner",
      );
    }
    return target;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function isRecordNotFoundError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
  );
}
