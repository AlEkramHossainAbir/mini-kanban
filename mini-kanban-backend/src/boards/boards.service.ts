import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BoardRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { decodeCursor, encodeCursor } from './cursor.util';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateBoardDto } from './dto/create-board.dto';
import { ListBoardsQueryDto } from './dto/list-boards-query.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

const MEMBER_SELECT = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.BoardMemberSelect;

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

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
          orderBy: { rank: 'asc' },
          select: {
            id: true,
            boardId: true,
            title: true,
            rank: true,
            createdAt: true,
            updatedAt: true,
            tasks: {
              orderBy: { rank: 'asc' },
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

  async remove(boardId: string): Promise<void> {
    // Columns → tasks cascade via the FK onDelete: Cascade in the schema.
    await this.prisma.board.delete({ where: { id: boardId } });
  }

  listMembers(boardId: string) {
    return this.prisma.boardMember.findMany({
      where: { boardId },
      orderBy: { createdAt: 'asc' },
      select: MEMBER_SELECT,
    });
  }

  async addMember(boardId: string, dto: AddMemberDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Sharing only works with an already-registered user (PLAN §3) — no
    // pending-invite-by-email flow in the 4-day MVP scope.
    if (!user) {
      throw new NotFoundException('No registered user with that email');
    }

    try {
      return await this.prisma.boardMember.create({
        data: { boardId, userId: user.id, role: dto.role },
        select: MEMBER_SELECT,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new ConflictException('User is already a member of this board');
      }
      throw err;
    }
  }

  async updateMemberRole(boardId: string, userId: string, role: BoardRole) {
    await this.assertLastOwnerSafe(boardId, userId, role);
    try {
      return await this.prisma.boardMember.update({
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
  }

  async removeMember(boardId: string, userId: string): Promise<void> {
    await this.assertLastOwnerSafe(boardId, userId, null);
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
  }

  /**
   * A board can never end up ownerless (PLAN §4): rejects demoting a member
   * away from OWNER, or removing one (`newRole: null`), if they're the
   * board's last remaining OWNER.
   */
  private async assertLastOwnerSafe(
    boardId: string,
    userId: string,
    newRole: BoardRole | null,
  ): Promise<void> {
    if (newRole === BoardRole.OWNER) {
      return; // staying/becoming OWNER never reduces the owner count
    }
    const target = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
    });
    if (!target || target.role !== BoardRole.OWNER) {
      return; // wasn't an owner to begin with — nothing to protect
    }
    const ownerCount = await this.prisma.boardMember.count({
      where: { boardId, role: BoardRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new ConflictException(
        "Cannot remove or demote the board's last owner",
      );
    }
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
