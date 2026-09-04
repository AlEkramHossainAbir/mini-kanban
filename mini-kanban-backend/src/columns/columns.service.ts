import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  RANK_LENGTH_REBALANCE_THRESHOLD,
  between,
  first,
  last,
  rebalance,
} from '../tasks/rank.util';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

interface ColumnRankRow {
  id: string;
  rank: string;
}

@Injectable()
export class ColumnsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(boardId: string, dto: CreateColumnDto) {
    const lastColumn = await this.prisma.column.findFirst({
      where: { boardId },
      orderBy: [{ rank: 'desc' }, { id: 'desc' }],
      select: { rank: true },
    });
    const rank = between(lastColumn?.rank ?? first(), last());
    return this.prisma.column.create({
      data: { boardId, title: dto.title, rank },
    });
  }

  update(columnId: string, dto: UpdateColumnDto) {
    return this.prisma.column.update({
      where: { id: columnId },
      data: { title: dto.title },
    });
  }

  async remove(columnId: string): Promise<void> {
    // Tasks cascade via the FK onDelete: Cascade in the schema.
    await this.prisma.column.delete({ where: { id: columnId } });
  }

  async move(boardId: string, columnId: string, dto: MoveColumnDto) {
    return this.prisma.$transaction(async (tx) => {
      const others = await tx.column.findMany({
        where: { boardId, id: { not: columnId } },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { id: true, rank: true },
      });

      const { lowerBound, upperBound, insertIndex } = resolveMoveBounds(
        others,
        dto,
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

function resolveMoveBounds(
  others: ColumnRankRow[],
  dto: MoveColumnDto,
): { lowerBound: string; upperBound: string; insertIndex: number } {
  const hasNeighborIds =
    dto.beforeColumnId != null || dto.afterColumnId != null;

  if (hasNeighborIds) {
    // Self-healing (PLAN §3): a referenced neighbor that no longer exists
    // (moved elsewhere, deleted since the client last saw it) falls back to
    // the sentinel boundary on that side, rather than erroring.
    const beforeIdx = dto.beforeColumnId
      ? others.findIndex((c) => c.id === dto.beforeColumnId)
      : -1;
    const afterIdx = dto.afterColumnId
      ? others.findIndex((c) => c.id === dto.afterColumnId)
      : -1;
    return {
      lowerBound: beforeIdx >= 0 ? others[beforeIdx].rank : first(),
      upperBound: afterIdx >= 0 ? others[afterIdx].rank : last(),
      insertIndex:
        beforeIdx >= 0
          ? beforeIdx + 1
          : afterIdx >= 0
            ? afterIdx
            : others.length,
    };
  }

  // No neighbor ids at all: fall back to `position` (clamped, PLAN §3), or
  // append at the end if nothing was supplied.
  const clamped = Math.max(
    0,
    Math.min(dto.position ?? others.length, others.length),
  );
  return {
    lowerBound: clamped > 0 ? others[clamped - 1].rank : first(),
    upperBound: clamped < others.length ? others[clamped].rank : last(),
    insertIndex: clamped,
  };
}
