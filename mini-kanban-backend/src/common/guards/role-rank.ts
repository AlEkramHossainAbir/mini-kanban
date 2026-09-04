import { BoardRole } from '@prisma/client';

// Higher number = more privilege. RolesGuard compares by rank so
// "@RequireRole(EDITOR)" reads as "EDITOR or above" (PLAN §3/§4's "EDITOR+"),
// not an exact-match check.
export const ROLE_RANK: Record<BoardRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};
