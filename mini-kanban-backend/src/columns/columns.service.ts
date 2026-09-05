import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BOARD_EVENTS, BoardGateway } from '../gateway/board.gateway';
import {
  RANK_LENGTH_REBALANCE_THRESHOLD,
  between,
  first,
  last,
  rebalance,
  resolveNeighborBounds,
} from '../tasks/rank.util';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@Injectable()
export class ColumnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: BoardGateway,
  ) {}

  /** Appends at the end, rebalancing if that pushes the rank past the
   *  threshold — the same fix, and the same reasoning, as
   *  `TasksService.create`'s docblock spells out. Far less reachable here
   *  (it takes ~241 columns on one board), but the two `create` paths are
   *  identical in shape and there is no reason for only one of them to be
   *  correct. */
  async create(boardId: string, dto: CreateColumnDto) {
    const column = await this.prisma.$transaction(async (tx) => {
      const lastColumn = await tx.column.findFirst({
        where: { boardId },
        orderBy: [{ rank: 'desc' }, { id: 'desc' }],
        select: { rank: true },
      });
      const rank = between(lastColumn?.rank ?? first(), last());
      const created = await tx.column.create({
        data: { boardId, title: dto.title, rank },
      });

      if (rank.length <= RANK_LENGTH_REBALANCE_THRESHOLD) {
        return created;
      }

      const siblings = await tx.column.findMany({
        where: { boardId },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const rebalanced = rebalance(siblings.map((c) => c.id));
      await Promise.all(
        siblings.map((sibling, idx) =>
          tx.column.update({
            where: { id: sibling.id },
            data: { rank: rebalanced[idx] },
          }),
        ),
      );
      return tx.column.findUniqueOrThrow({ where: { id: created.id } });
    });

    this.gateway.emit(boardId, BOARD_EVENTS.columnCreated, column);
    return column;
  }

  async update(columnId: string, dto: UpdateColumnDto) {
    const column = await this.prisma.column.update({
      where: { id: columnId },
      data: { title: dto.title },
    });
    this.gateway.emit(column.boardId, BOARD_EVENTS.columnUpdated, column);
    return column;
  }

  async remove(columnId: string): Promise<void> {
    // Tasks cascade via the FK onDelete: Cascade in the schema. delete()
    // returns the removed row, which is how we still know the boardId.
    const column = await this.prisma.column.delete({ where: { id: columnId } });
    this.gateway.emit(column.boardId, BOARD_EVENTS.columnDeleted, {
      id: column.id,
      boardId: column.boardId,
    });
  }

  async move(boardId: string, columnId: string, dto: MoveColumnDto) {
    const moved = await this.moveWithinTransaction(boardId, columnId, dto);
    // After commit, never inside the transaction (ROADMAP Phase 9).
    this.gateway.emit(boardId, BOARD_EVENTS.columnMoved, moved);
    return moved;
  }

  private async moveWithinTransaction(
    boardId: string,
    columnId: string,
    dto: MoveColumnDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const others = await tx.column.findMany({
        where: { boardId, id: { not: columnId } },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { id: true, rank: true },
      });

      const { lowerBound, upperBound, insertIndex } = resolveNeighborBounds(
        others,
        {
          beforeId: dto.beforeColumnId,
          afterId: dto.afterColumnId,
          position: dto.position,
        },
      );
      const newRank = between(lowerBound, upperBound);

      if (newRank.length <= RANK_LENGTH_REBALANCE_THRESHOLD) {
        return tx.column.update({
          where: { id: columnId },
          data: { rank: newRank },
        });
      }

      // Repeated inserts at the same boundary have made this rank too long
      // — re-space every column on the board (including this one, at its
      // resolved position) instead of letting ranks grow unbounded (PLAN §2).
      const orderedIds = others.map((c) => c.id);
      orderedIds.splice(insertIndex, 0, columnId);
      const rebalanced = rebalance(orderedIds);
      await Promise.all(
        orderedIds.map((id, idx) =>
          tx.column.update({ where: { id }, data: { rank: rebalanced[idx] } }),
        ),
      );
      return tx.column.findUniqueOrThrow({ where: { id: columnId } });
    });
  }
}
