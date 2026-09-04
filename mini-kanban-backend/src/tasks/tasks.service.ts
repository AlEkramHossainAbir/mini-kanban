import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BOARD_EVENTS, BoardGateway } from '../gateway/board.gateway';
import { CreateTaskDto } from './dto/create-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  RANK_LENGTH_REBALANCE_THRESHOLD,
  between,
  first,
  last,
  rebalance,
  resolveNeighborBounds,
} from './rank.util';
import { TaskVersionConflictException } from './task-version-conflict.exception';

// PLAN §3's move-response shape — deliberately minimal (id/columnId/rank/
// version/updatedAt only, not the full task).
const MOVE_RESULT_SELECT = {
  id: true,
  columnId: true,
  rank: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: BoardGateway,
  ) {}

  async create(boardId: string, columnId: string, dto: CreateTaskDto) {
    const lastTask = await this.prisma.task.findFirst({
      where: { columnId },
      orderBy: [{ rank: 'desc' }, { id: 'desc' }],
      select: { rank: true },
    });
    const rank = between(lastTask?.rank ?? first(), last());
    const task = await this.prisma.task.create({
      data: {
        boardId,
        columnId,
        title: dto.title,
        description: dto.description,
        rank,
      },
    });
    this.gateway.emit(boardId, BOARD_EVENTS.taskCreated, task);
    return task;
  }

  async update(taskId: string, dto: UpdateTaskDto) {
    // Title/description only. Deliberately does NOT bump `version`: version
    // exists to detect a stale *position* (PLAN §3), and bumping it on an
    // unrelated field edit would manufacture false move conflicts for
    // anyone mid-drag, not just catch real ones.
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: dto,
    });
    this.gateway.emit(task.boardId, BOARD_EVENTS.taskUpdated, task);
    return task;
  }

  async remove(taskId: string): Promise<void> {
    // delete() returns the row it removed, which is how we still know the
    // boardId to broadcast on after it's gone.
    const task = await this.prisma.task.delete({ where: { id: taskId } });
    this.gateway.emit(task.boardId, BOARD_EVENTS.taskDeleted, {
      id: task.id,
      columnId: task.columnId,
      boardId: task.boardId,
    });
  }

  async move(boardId: string, taskId: string, dto: MoveTaskDto) {
    const targetColumn = await this.prisma.column.findUnique({
      where: { id: dto.targetColumnId },
      select: { boardId: true },
    });
    // A task can never move to another board's column (PLAN §3, §2's
    // hardening note). This is also what keeps `Task.boardId` "in sync"
    // (ROADMAP Phase 8): boardId simply never needs rewriting during a
    // move, because the one operation that could ever make it drift is
    // rejected here before any transaction starts. This doubles as an
    // authorization check: without it, an EDITOR on this board could
    // target a column belonging to a board they have no access to.
    if (!targetColumn || targetColumn.boardId !== boardId) {
      throw new BadRequestException('INVALID_TARGET_COLUMN');
    }

    try {
      return this.broadcastMove(boardId, await this.attemptMove(taskId, dto));
    } catch (err) {
      if (!isSerializationFailure(err)) {
        throw err;
      }
      // One retry against fresh state (PLAN §3), then give up.
      try {
        return this.broadcastMove(boardId, await this.attemptMove(taskId, dto));
      } catch (retryErr) {
        if (!isSerializationFailure(retryErr)) {
          throw retryErr;
        }
        const currentTask = await this.prisma.task.findUniqueOrThrow({
          where: { id: taskId },
          select: MOVE_RESULT_SELECT,
        });
        throw new TaskVersionConflictException(currentTask);
      }
    }
  }

  /**
   * Broadcast only once the move transaction has actually committed
   * (ROADMAP Phase 9: "emit ... **after commit**"). Announcing a write that
   * then rolls back would be worse than staying silent, and a 409 conflict
   * must emit nothing at all — the losing caller changed no state.
   */
  private broadcastMove<T>(boardId: string, moved: T): T {
    this.gateway.emit(boardId, BOARD_EVENTS.taskMoved, moved);
    return moved;
  }

  /**
   * One full read-compute-write attempt, wrapped in a `SERIALIZABLE`
   * transaction (PLAN §3). No explicit row locks are ever taken — the
   * neighbor read is a plain MVCC snapshot, and the write is a single
   * conditional `UPDATE ... WHERE id = ? AND version = ?` — so two
   * concurrent moves can never deadlock each other (§3's deadlock-avoidance
   * note); `SERIALIZABLE` is what catches the subtler race where two
   * transactions compute the *same* midpoint from the same neighbor pair.
   */
  private async attemptMove(taskId: string, dto: MoveTaskDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const others = await tx.task.findMany({
          where: { columnId: dto.targetColumnId, id: { not: taskId } },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: { id: true, rank: true },
        });

        const { lowerBound, upperBound, insertIndex } = resolveNeighborBounds(
          others,
          {
            beforeId: dto.beforeTaskId,
            afterId: dto.afterTaskId,
            position: dto.position,
          },
        );
        const newRank = between(lowerBound, upperBound);

        // The conditional write: a zero-row match means someone else moved
        // this task first (PLAN §3) — the version we expected is gone.
        const updateResult = await tx.task.updateMany({
          where: { id: taskId, version: dto.expectedVersion },
          data: {
            rank: newRank,
            columnId: dto.targetColumnId,
            version: { increment: 1 },
          },
        });

        if (updateResult.count === 0) {
          const currentTask = await tx.task.findUniqueOrThrow({
            where: { id: taskId },
            select: MOVE_RESULT_SELECT,
          });
          throw new TaskVersionConflictException(currentTask);
        }

        if (newRank.length > RANK_LENGTH_REBALANCE_THRESHOLD) {
          // Repeated inserts at the same boundary have made this rank too
          // long — re-space every task in *this column only* (PLAN §2),
          // including the moved one at its resolved position.
          const orderedIds = others.map((t) => t.id);
          orderedIds.splice(insertIndex, 0, taskId);
          const rebalanced = rebalance(orderedIds);
          await Promise.all(
            orderedIds.map((id, idx) =>
              tx.task.update({
                where: { id },
                data: { rank: rebalanced[idx] },
              }),
            ),
          );
        }

        return tx.task.findUniqueOrThrow({
          where: { id: taskId },
          select: MOVE_RESULT_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

function isSerializationFailure(err: unknown): boolean {
  // Prisma's code for "transaction failed due to a write conflict or a
  // deadlock" under an interactive transaction — the only failure mode a
  // SERIALIZABLE move transaction can hit here (PLAN §3).
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
  );
}
