import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { BoardRole } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Express route params are typed `string | string[]` (array only for
// repeated wildcard segments, which no route here uses) — an id param is
// always a single string in practice; an array means a malformed request.
function asId(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export interface BoardScopedRequest extends Request {
  user?: { id: string; email: string; name: string };
  boardRole?: BoardRole;
  boardId?: string;
}

/**
 * Resolves which board a route touches — directly from `:boardId`, or via a
 * lookup when the route only carries `:columnId`/`:taskId` — then requires
 * the caller to have a `BoardMember` row on that board. Meant to be applied
 * with `@UseGuards(BoardAccessGuard, RolesGuard)` on every controller that
 * touches board/column/task data (BoardsController, ColumnsController,
 * TasksController — Phases 6–8), never as a global guard: `/auth` and
 * `/health` have no board to resolve (PLAN §4).
 *
 * Runs after JwtAuthGuard (needs `req.user`) and before RolesGuard (needs
 * `req.boardRole`, set here) — enforced by listing them in that order in
 * each controller's `@UseGuards(...)`.
 *
 * **Contract for Phase 6–8 route params:** a board-root route names its
 * param `:boardId`; a column-scoped route (`PATCH /columns/:columnId`, …)
 * names it `:columnId`; a task-scoped route names it `:taskId`. This guard
 * tells the three apart by param name, not by which controller it's on, so
 * that naming is load-bearing, not a style choice.
 */
@Injectable()
export class BoardAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BoardScopedRequest>();

    const boardId = await this.resolveBoardId(req.params);
    // Deliberately the same 403 whether the referenced board/column/task
    // doesn't exist at all or just isn't accessible to this caller. This
    // guard's only job is authorization — folding "not found" into
    // "forbidden" here closes the classic IDOR oracle (a distinct status
    // code that would let an attacker tell "wrong id" apart from "someone
    // else's board") before any service code ever runs (PLAN §4).
    if (!boardId) {
      throw new ForbiddenException();
    }

    const membership = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: req.user!.id } },
    });
    if (!membership) {
      throw new ForbiddenException();
    }

    req.boardRole = membership.role;
    req.boardId = boardId;
    return true;
  }

  private async resolveBoardId(
    params: Request['params'],
  ): Promise<string | null> {
    const boardId = asId(params.boardId);
    if (boardId) {
      return boardId;
    }
    const columnId = asId(params.columnId);
    if (columnId) {
      const column = await this.prisma.column.findUnique({
        where: { id: columnId },
        select: { boardId: true },
      });
      return column?.boardId ?? null;
    }
    const taskId = asId(params.taskId);
    if (taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { boardId: true },
      });
      return task?.boardId ?? null;
    }
    return null;
  }
}
