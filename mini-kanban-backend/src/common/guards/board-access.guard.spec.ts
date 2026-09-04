import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BoardAccessGuard, BoardScopedRequest } from './board-access.guard';

function mockContext(req: Partial<BoardScopedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('BoardAccessGuard', () => {
  const caller = { id: 'user-1', email: 'a@example.com', name: 'A' };

  // A hand-rolled stub, not a mocking library — only the two model methods
  // the guard actually calls are exercised.
  function stubPrisma(overrides: {
    membership?: { role: string } | null;
    column?: { boardId: string } | null;
    task?: { boardId: string } | null;
  }) {
    return {
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(overrides.membership ?? null),
      },
      column: {
        findUnique: jest.fn().mockResolvedValue(overrides.column ?? null),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue(overrides.task ?? null),
      },
    } as any;
  }

  it('allows a member and attaches req.boardRole from :boardId directly', async () => {
    const prisma = stubPrisma({ membership: { role: 'EDITOR' } });
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = {
      params: { boardId: 'board-1' },
      user: caller,
    };

    await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
    expect(req.boardRole).toBe('EDITOR');
    expect(req.boardId).toBe('board-1');
    expect(prisma.boardMember.findUnique).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: 'board-1', userId: 'user-1' } },
    });
  });

  it('403s when the caller has no BoardMember row on that board', async () => {
    const prisma = stubPrisma({ membership: null });
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = {
      params: { boardId: 'board-1' },
      user: caller,
    };

    await expect(guard.canActivate(mockContext(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves boardId via :taskId and 403s for a task on someone else\'s board — the "Done when" case', async () => {
    // The task belongs to board-other; the caller has no membership row for
    // that board (only, hypothetically, their own unrelated board).
    const prisma = stubPrisma({
      task: { boardId: 'board-other' },
      membership: null,
    });
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = {
      params: { taskId: 'task-99' },
      user: caller,
    };

    await expect(guard.canActivate(mockContext(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.task.findUnique).toHaveBeenCalledWith({
      where: { id: 'task-99' },
      select: { boardId: true },
    });
    // The membership check must run against the task's *actual* board, not
    // anything the caller supplied.
    expect(prisma.boardMember.findUnique).toHaveBeenCalledWith({
      where: {
        boardId_userId: { boardId: 'board-other', userId: 'user-1' },
      },
    });
  });

  it('allows a member reached via :columnId', async () => {
    const prisma = stubPrisma({
      column: { boardId: 'board-1' },
      membership: { role: 'VIEWER' },
    });
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = {
      params: { columnId: 'col-1' },
      user: caller,
    };

    await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
    expect(req.boardRole).toBe('VIEWER');
  });

  it('403s (not a 404) for a taskId that does not exist — never leaks which is which', async () => {
    const prisma = stubPrisma({ task: null });
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = {
      params: { taskId: 'ghost-task' },
      user: caller,
    };

    await expect(guard.canActivate(mockContext(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Never reaches the membership query — there's no board to check.
    expect(prisma.boardMember.findUnique).not.toHaveBeenCalled();
  });

  it('403s when the route carries none of boardId/columnId/taskId', async () => {
    const prisma = stubPrisma({});
    const guard = new BoardAccessGuard(prisma);
    const req: Partial<BoardScopedRequest> = { params: {}, user: caller };

    await expect(guard.canActivate(mockContext(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
