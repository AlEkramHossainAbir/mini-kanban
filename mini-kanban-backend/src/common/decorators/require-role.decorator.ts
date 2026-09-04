import { SetMetadata } from '@nestjs/common';
import { BoardRole } from '@prisma/client';

export const REQUIRE_ROLE_KEY = 'requiredRole';

/**
 * Minimum BoardRole a route needs, checked by RolesGuard against
 * `req.boardRole` (set by BoardAccessGuard). `@RequireRole(BoardRole.EDITOR)`
 * means "EDITOR or OWNER" — RolesGuard compares by rank, not equality
 * (PLAN §3/§4's "EDITOR+" shorthand).
 */
export const RequireRole = (role: BoardRole) =>
  SetMetadata(REQUIRE_ROLE_KEY, role);
