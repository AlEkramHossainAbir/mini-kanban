import { PrismaService } from '../common/prisma/prisma.service';
import { BoardGateway } from '../gateway/board.gateway';
import { ColumnsService } from './columns.service';

interface RankedRow {
  id: string;
  rank: string;
}
interface UpdateArgs {
  where: { id: string };
  data: { rank: string };
}
interface FindUniqueArgs {
  where: { id: string };
}

/** Only the surface `ColumnsService` actually touches — narrowed to a real
 *  shape rather than `any`, so a typo in a stubbed method name is a compile
 *  error here instead of an `undefined is not a function` at run time. */
interface PrismaStub {
  column: {
    findMany: jest.Mock;
    update: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  $transaction: jest.Mock;
}

// A hand-rolled stub, not a mocking library — only what the service
// actually calls on `tx` (== `prisma` here, since $transaction just invokes
// the callback with this same stub) is exercised.
function stubPrisma(columns: RankedRow[]) {
  const updateCalls: RankedRow[] = [];
  const prisma: PrismaStub = {
    column: {
      findMany: jest.fn().mockResolvedValue(columns),
      update: jest.fn(({ where, data }: UpdateArgs) => {
        updateCalls.push({ id: where.id, rank: data.rank });
        return Promise.resolve({ id: where.id, rank: data.rank });
      }),
      findUniqueOrThrow: jest.fn(({ where }: FindUniqueArgs) =>
        Promise.resolve({
          id: where.id,
          rank: updateCalls.find((u) => u.id === where.id)?.rank,
        }),
      ),
    },
    $transaction: jest.fn(),
  };
  // Assigned after the literal so the callback can close over `prisma`
  // itself — Prisma's interactive transaction hands the callback a client,
  // and here that client is this same stub.
  prisma.$transaction.mockImplementation((fn: (tx: PrismaStub) => unknown) =>
    fn(prisma),
  );
  return { prisma, updateCalls };
}

/** The single cast, made once and named: a structural stub standing in for
 *  the real client. `as unknown as` rather than `as any` keeps the assertion
 *  explicit and local instead of disabling checking for the whole value. */
const asPrisma = (stub: PrismaStub): PrismaService =>
  stub as unknown as PrismaService;

// The gateway is a broadcast side-channel: these tests assert persistence
// behaviour, so a no-op stub keeps them focused. Gateway authorization has
// its own spec.
const noopGateway = { emit: jest.fn() } as unknown as BoardGateway;

describe('ColumnsService.move — rebalance trigger', () => {
  it('writes only the moved column when the computed rank stays short', async () => {
    const { prisma, updateCalls } = stubPrisma([{ id: 'b', rank: 'm' }]);
    const service = new ColumnsService(asPrisma(prisma), noopGateway);

    await service.move('board-1', 'a', { afterColumnId: 'b' });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe('a');
    expect(updateCalls[0].rank.length).toBeLessThanOrEqual(40);
  });

  it('rebalances every column on the board once the computed rank exceeds the threshold', async () => {
    // Crafted so between(first(), boundary) is forced past 40 characters:
    // `first()` always contributes an implicit '0' digit at every position,
    // so 40 leading '0's followed by a '1' keeps the walk in the
    // equal-then-adjacent path for all 40 positions before it's forced to
    // grow a 41st+ character (see rank.util.spec.ts for the adjacent-digit
    // mechanics this relies on).
    const longBoundary = '0'.repeat(40) + '1';
    const { prisma, updateCalls } = stubPrisma([
      { id: 'existing', rank: longBoundary },
    ]);
    const service = new ColumnsService(asPrisma(prisma), noopGateway);

    const result = await service.move('board-1', 'moved', {
      afterColumnId: 'existing',
    });

    // Every column on the board got a fresh, short rank — not just the one
    // that was moved.
    const rebalancedIds = updateCalls.map((u) => u.id).sort();
    expect(rebalancedIds).toEqual(['existing', 'moved']);
    for (const call of updateCalls) {
      expect(call.rank.length).toBeLessThanOrEqual(40);
    }
    // Relative order preserved: the moved column was inserted before
    // "existing" (afterColumnId: 'existing'), so it must still rank first.
    const movedRank = updateCalls.find((u) => u.id === 'moved')!.rank;
    const existingRank = updateCalls.find((u) => u.id === 'existing')!.rank;
    expect(movedRank < existingRank).toBe(true);
    expect(prisma.column.findUniqueOrThrow as jest.Mock).toHaveBeenCalledWith({
      where: { id: 'moved' },
    });
    expect(result).toMatchObject({ id: 'moved', rank: movedRank });
  });
});
