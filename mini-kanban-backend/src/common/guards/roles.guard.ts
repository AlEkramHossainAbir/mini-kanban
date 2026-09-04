import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BoardRole } from '@prisma/client';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator';
import { BoardScopedRequest } from './board-access.guard';
import { ROLE_RANK } from './role-rank';

/**
 * Must run after BoardAccessGuard, which attaches `req.boardRole`. A route
 * with no `@RequireRole(...)` is membership-only (any role — e.g. a plain
 * GET) and this guard is a no-op for it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<BoardRole>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRole) {
      return true;
    }

    const req = context.switchToHttp().getRequest<BoardScopedRequest>();
    if (!req.boardRole || ROLE_RANK[req.boardRole] < ROLE_RANK[requiredRole]) {
      throw new ForbiddenException();
    }
    return true;
  }
}
