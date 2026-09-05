import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BoardGateway } from '../gateway/board.gateway';
import { TaskVersionConflictException } from './task-version-conflict.exception';
import { TasksService } from './tasks.service';

interface RankedRow {
  id: string;
  rank: string;
}
/** The `data` payload of the conditional `updateMany` the move performs. */
interface MoveUpdateData {
  rank: string;
  columnId: string;
  version: { increment: number };
}
interface UpdateManyArgs {
  data: MoveUpdateData;
}
interface UpdateArgs {
  where: { id: string };
  data: { rank: string };
}

/** Only the surface `TasksService.move` actually touches — a real shape
 *  rather than `any`, so a typo in a stubbed method name fails at compile
 *  time instead of as `undefined is not a function` mid-test. */
interface PrismaStub {
  column: { findUnique: jest.Mock };
  task: {
    findMany?: jest.Mock;
    updateMany?: jest.Mock;
    update?: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  $transaction: jest.Mock;
}

/** The single cast, made once and named: a structural stub standing in for
 *  the real client. `as unknown as` rather than `as any` keeps the assertion
 *  explicit and local instead of disabling checking for the whole value. */
const asPrisma = (stub: PrismaStub): PrismaService =>
  stub as unknown as PrismaService;

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
  const updateManyCalls: UpdateManyArgs[] = [];
  const singleUpdateCalls: RankedRow[] = [];
  let transactionCallIndex = -1;
  let currentTaskRank = 'm';
  let currentTaskColumnId = 'col-original';
  let currentTaskVersion = 5;

  const prisma: PrismaStub = {
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
      updateMany: jest.fn(({ data }: UpdateManyArgs) => {
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
      update: jest.fn(({ where, data }: UpdateArgs) => {
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
    $transaction: jest.fn(),
  };
  // Assigned after the literal so the callback can close over `prisma`
  // itself — Prisma's interactive transaction hands the callback a client,
  // and here that client is this same stub.
  prisma.$transaction.mockImplementation((fn: (tx: PrismaStub) => unknown) => {
    transactionCallIndex++;
    if (options.throwOnTransactionCall?.index === transactionCallIndex) {
      return Promise.reject(options.throwOnTransactionCall.error);
    }
    return fn(prisma);
  });

  return { prisma, updateManyCalls, singleUpdateCalls };
}

// The gateway is a broadcast side-channel: these tests assert persistence
// behaviour, so a no-op stub keeps them focused. Gateway authorization has
// its own spec.
const noopGateway = { emit: jest.fn() } as unknown as BoardGateway;

describe('TasksService.move', () => {
  it('rejects a target column on a different board with 400 INVALID_TARGET_COLUMN', async () => {
    const { prisma } = stubPrisma({
      targetColumnBoardId: 'other-board',
      others: [],
    });
    const service = new TasksService(asPrisma(prisma), noopGateway);

    await expect(
      service.move('board-1', 'moved-task', {
        targetColumnId: 'col-x',
        expectedVersion: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a nonexistent target column the same way', async () => {
    const { prisma } = stubPrisma({ targetColumnBoardId: null, others: [] });
    const service = new TasksService(asPrisma(prisma), noopGateway);

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
    const service = new TasksService(asPrisma(prisma), noopGateway);

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
    const service = new TasksService(asPrisma(prisma), noopGateway);

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
    const service = new TasksService(asPrisma(prisma), noopGateway);

    const result = await service.move('board-1', 'moved-task', {
      targetColumnId: 'col-x',
      expectedVersion: 5,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty('id', 'moved-task');
  });

  it('gives up with VERSION_CONFLICT after the retry also fails to serialize', async () => {
    const prisma: PrismaStub = {
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
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(serializationFailure())
        .mockRejectedValueOnce(serializationFailure()),
    };
    const service = new TasksService(asPrisma(prisma), noopGateway);

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
    const service = new TasksService(asPrisma(prisma), noopGateway);

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

describe('TasksService.create — rank growth', () => {
  /** Stub for the append path: findFirst returns the current last rank,
   *  create echoes what it was given, findMany/update back the rebalance. */
  function stubCreatePrisma(lastRank: string | null, siblingIds: string[]) {
    const updateCalls: RankedRow[] = [];
    let createdRank = '';
    const prisma: PrismaStub = {
      column: { findUnique: jest.fn() },
      task: {
        findMany: jest.fn().mockResolvedValue(siblingIds.map((id) => ({ id }))),
        update: jest.fn(({ where, data }: UpdateArgs) => {
          updateCalls.push({ id: where.id, rank: data.rank });
          return Promise.resolve({ id: where.id, rank: data.rank });
        }),
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            id: 'new-task',
            rank: updateCalls.find((u) => u.id === 'new-task')?.rank,
          }),
        ),
      },
      $transaction: jest.fn(),
    };
    Object.assign(prisma.task, {
      findFirst: jest
        .fn()
        .mockResolvedValue(lastRank === null ? null : { rank: lastRank }),
      create: jest.fn(({ data }: { data: { rank: string } }) => {
        createdRank = data.rank;
        return Promise.resolve({
          id: 'new-task',
          boardId: 'board-1',
          rank: data.rank,
        });
      }),
    });
    prisma.$transaction.mockImplementation((fn: (tx: PrismaStub) => unknown) =>
      fn(prisma),
    );
    return { prisma, updateCalls, createdRank: () => createdRank };
  }

  it('does not rebalance when the appended rank stays short', async () => {
    const { prisma, updateCalls } = stubCreatePrisma('m', []);
    const service = new TasksService(asPrisma(prisma), noopGateway);

    await service.create('board-1', 'col-1', { title: 'T' });

    expect(updateCalls).toHaveLength(0);
  });

  it('rebalances the column once an appended rank exceeds the threshold', async () => {
    // Forces between(lastRank, last()) past 40 chars. `last()` is 'z', so
    // position 0 is the adjacent pair y|z — the walk commits to 'y' and
    // continues unconstrained above; every following 'z' digit is then
    // adjacent to that unconstrained bound too, so the result grows one
    // character per 'z' before it can finally split. 1 + 40 + 1 = 42 chars.
    const longLast = 'y' + 'z'.repeat(40);
    const { prisma, updateCalls } = stubCreatePrisma(longLast, [
      'older',
      'new-task',
    ]);
    const service = new TasksService(asPrisma(prisma), noopGateway);

    await service.create('board-1', 'col-1', { title: 'T' });

    // Every task in the column was re-spaced, not just the new one — and
    // every resulting rank is back under the threshold.
    expect(updateCalls.map((u) => u.id).sort()).toEqual(['new-task', 'older']);
    for (const call of updateCalls) {
      expect(call.rank.length).toBeLessThanOrEqual(40);
    }
    // Relative order preserved: the appended task still sorts last.
    const older = updateCalls.find((u) => u.id === 'older')!.rank;
    const appended = updateCalls.find((u) => u.id === 'new-task')!.rank;
    expect(older < appended).toBe(true);
  });
});
