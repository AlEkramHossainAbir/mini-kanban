import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaskVersionConflictException } from './task-version-conflict.exception';
import { TasksService } from './tasks.service';

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

// A hand-rolled stub, not a mocking library — only what the service
// actually calls is exercised. `$transaction` just invokes the callback
// with this same stub, mirroring how Prisma's interactive transactions work.
function stubPrisma(options: {
  targetColumnBoardId: string | null;
  others: { id: string; rank: string }[];
  /** How many rows the conditional updateMany "matches", per call (in order). */
  updateManyMatchCounts?: number[];
  /** Throw this from $transaction on the given call index (0-based), if set. */
  throwOnTransactionCall?: { index: number; error: unknown };
}) {
  const updateManyCalls: any[] = [];
  const singleUpdateCalls: { id: string; rank: string }[] = [];
  let transactionCallIndex = -1;
  let currentTaskRank = 'm';
  let currentTaskColumnId = 'col-original';
  let currentTaskVersion = 5;

  const prisma: any = {
    column: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.targetColumnBoardId === null
            ? null
            : { boardId: options.targetColumnBoardId },
        ),
    },
    task: {
      findMany: jest.fn().mockResolvedValue(options.others),
      updateMany: jest.fn(({ data }: any) => {
        const callIndex = updateManyCalls.length;
        updateManyCalls.push({ data });
        const matchCount = options.updateManyMatchCounts?.[callIndex] ?? 1;
        if (matchCount > 0) {
          currentTaskRank = data.rank;
          currentTaskColumnId = data.columnId;
          currentTaskVersion += 1;
        }
        return Promise.resolve({ count: matchCount });
      }),
      update: jest.fn(({ where, data }: any) => {
        singleUpdateCalls.push({ id: where.id, rank: data.rank });
        return Promise.resolve({ id: where.id, rank: data.rank });
      }),
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          id: 'moved-task',
          columnId: currentTaskColumnId,
          rank: currentTaskRank,
          version: currentTaskVersion,
          updatedAt: new Date(),
        }),
      ),
    },
  };
  prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => {
    transactionCallIndex++;
    if (options.throwOnTransactionCall?.index === transactionCallIndex) {
      return Promise.reject(options.throwOnTransactionCall.error);
    }
    return fn(prisma);
  });

  return { prisma, updateManyCalls, singleUpdateCalls };
}

describe('TasksService.move', () => {
  it('rejects a target column on a different board with 400 INVALID_TARGET_COLUMN', async () => {
    const { prisma } = stubPrisma({
      targetColumnBoardId: 'other-board',
      others: [],
    });
    const service = new TasksService(prisma);

    await expect(
      service.move('board-1', 'moved-task', {
        targetColumnId: 'col-x',
        expectedVersion: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a nonexistent target column the same way', async () => {
    const { prisma } = stubPrisma({ targetColumnBoardId: null, others: [] });
    const service = new TasksService(prisma);

    await expect(
      service.move('board-1', 'moved-task', {
        targetColumnId: 'col-x',
        expectedVersion: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('on a stale expectedVersion, throws VERSION_CONFLICT carrying the fresh row', async () => {
    const { prisma } = stubPrisma({
      targetColumnBoardId: 'board-1',
      others: [{ id: 'sibling', rank: 'm' }],
      updateManyMatchCounts: [0], // conditional write matches nothing — someone else moved it first
    });
    const service = new TasksService(prisma);

    await expect(
      service.move('board-1', 'moved-task', {
        targetColumnId: 'col-x',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { error: 'VERSION_CONFLICT' },
    });
  });

  it('a successful move applies the conditional update exactly once and returns the minimal shape', async () => {
    const { prisma, updateManyCalls } = stubPrisma({
      targetColumnBoardId: 'board-1',
      others: [{ id: 'sibling', rank: 'm' }],
      updateManyMatchCounts: [1],
    });
    const service = new TasksService(prisma);

    const result = await service.move('board-1', 'moved-task', {
      targetColumnId: 'col-x',
      afterTaskId: 'sibling',
      expectedVersion: 5,
    });

    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].data.columnId).toBe('col-x');
    expect(updateManyCalls[0].data.version).toEqual({ increment: 1 });
    expect(result).toHaveProperty('id', 'moved-task');
    expect(result).toHaveProperty('columnId', 'col-x');
    expect(result).not.toHaveProperty('title'); // PLAN §3's minimal move response
  });

  it('retries once on a serialization failure, then succeeds', async () => {
    const { prisma } = stubPrisma({
      targetColumnBoardId: 'board-1',
      others: [],
      updateManyMatchCounts: [1],
      throwOnTransactionCall: { index: 0, error: serializationFailure() },
    });
    const service = new TasksService(prisma);

    const result = await service.move('board-1', 'moved-task', {
      targetColumnId: 'col-x',
      expectedVersion: 5,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty('id', 'moved-task');
  });

  it('gives up with VERSION_CONFLICT after the retry also fails to serialize', async () => {
    const prisma: any = {
      column: {
        findUnique: jest.fn().mockResolvedValue({ boardId: 'board-1' }),
      },
      task: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'moved-task',
          columnId: 'col-original',
          rank: 'm',
          version: 5,
          updatedAt: new Date(),
        }),
      },
    };
    prisma.$transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure());
    const service = new TasksService(prisma);

    await expect(
      service.move('board-1', 'moved-task', {
        targetColumnId: 'col-x',
        expectedVersion: 5,
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rebalances every task in the target column once the computed rank exceeds the threshold', async () => {
    // Same construction as columns.service.spec.ts: 40 leading '0's then a
    // '1' forces between(first(), boundary) past 40 characters.
    const longBoundary = '0'.repeat(40) + '1';
    const { prisma, singleUpdateCalls } = stubPrisma({
      targetColumnBoardId: 'board-1',
      others: [{ id: 'sibling', rank: longBoundary }],
      updateManyMatchCounts: [1],
    });
    const service = new TasksService(prisma);

    await service.move('board-1', 'moved-task', {
      targetColumnId: 'col-x',
      afterTaskId: 'sibling',
      expectedVersion: 5,
    });

    const rebalancedIds = singleUpdateCalls.map((u) => u.id).sort();
    expect(rebalancedIds).toEqual(['moved-task', 'sibling']);
    for (const call of singleUpdateCalls) {
      expect(call.rank.length).toBeLessThanOrEqual(40);
    }
  });
});
