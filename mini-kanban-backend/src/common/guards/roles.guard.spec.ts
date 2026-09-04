import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BoardRole } from '@prisma/client';
import { BoardScopedRequest } from './board-access.guard';
import { RolesGuard } from './roles.guard';

function mockContext(req: Partial<BoardScopedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as unknown as ExecutionContext;
}

function guardWithRequiredRole(required: BoardRole | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('is a no-op when the route has no @RequireRole()', () => {
    const guard = guardWithRequiredRole(undefined);
    const req: Partial<BoardScopedRequest> = { boardRole: undefined };

    expect(guard.canActivate(mockContext(req))).toBe(true);
  });

  it.each([
    ['OWNER', 'EDITOR', true],
    ['EDITOR', 'EDITOR', true],
    ['VIEWER', 'EDITOR', false],
    ['EDITOR', 'OWNER', false],
    ['OWNER', 'OWNER', true],
  ] as [BoardRole, BoardRole, boolean][])(
    'role %s against @RequireRole(%s) → allowed=%s',
    (actual, required, allowed) => {
      const guard = guardWithRequiredRole(required);
      const req: Partial<BoardScopedRequest> = { boardRole: actual };

      if (allowed) {
        expect(guard.canActivate(mockContext(req))).toBe(true);
      } else {
        expect(() => guard.canActivate(mockContext(req))).toThrow(
          ForbiddenException,
        );
      }
    },
  );

  it('403s if BoardAccessGuard never ran (no req.boardRole at all)', () => {
    const guard = guardWithRequiredRole('EDITOR' as BoardRole);
    const req: Partial<BoardScopedRequest> = {};

    expect(() => guard.canActivate(mockContext(req))).toThrow(
      ForbiddenException,
    );
  });
});
