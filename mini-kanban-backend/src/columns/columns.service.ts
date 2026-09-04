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

  async create(boardId: string, dto: CreateColumnDto) {
    const lastColumn = await this.prisma.column.findFirst({
      where: { boardId },
      orderBy: [{ rank: 'desc' }, { id: 'desc' }],
      select: { rank: true },
    });
    const rank = between(lastColumn?.rank ?? first(), last());
    const column = await this.prisma.column.create({
      data: { boardId, title: dto.title, rank },
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
