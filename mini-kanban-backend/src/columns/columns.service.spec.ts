import { ColumnsService } from './columns.service';

// A hand-rolled stub, not a mocking library — only what the service
// actually calls on `tx` (== `prisma` here, since $transaction just invokes
// the callback with this same stub) is exercised.
function stubPrisma(columns: { id: string; rank: string }[]) {
  const updateCalls: { id: string; rank: string }[] = [];
  const prisma: any = {
    column: {
      findMany: jest.fn().mockResolvedValue(columns),
      update: jest.fn(({ where, data }: any) => {
        updateCalls.push({ id: where.id, rank: data.rank });
        return Promise.resolve({ id: where.id, rank: data.rank });
      }),
      findUniqueOrThrow: jest.fn(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          rank: updateCalls.find((u) => u.id === where.id)?.rank,
        }),
      ),
    },
  };
  prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
  return { prisma, updateCalls };
}

// The gateway is a broadcast side-channel: these tests assert persistence
// behaviour, so a no-op stub keeps them focused. Gateway authorization has
// its own spec.
const noopGateway = { emit: jest.fn() } as any;

describe('ColumnsService.move — rebalance trigger', () => {
  it('writes only the moved column when the computed rank stays short', async () => {
    const { prisma, updateCalls } = stubPrisma([{ id: 'b', rank: 'm' }]);
    const service = new ColumnsService(prisma as any, noopGateway);

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
    const service = new ColumnsService(prisma as any, noopGateway);

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
