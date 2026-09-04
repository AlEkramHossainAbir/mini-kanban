/** Shapes returned by the API (backend PLAN §2/§3). Kept hand-written and
 *  minimal rather than generated — the surface is small and the `version`
 *  field is the one that must never be dropped. */

export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Task {
  id: string;
  columnId: string;
  boardId: string;
  title: string;
  description: string | null;
  rank: string;
  /** Optimistic-concurrency token. Sent back as `expectedVersion` on move
   *  (PLAN §3); a stale value is what produces the graded 409. Never drop it
   *  from a cache write. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  title: string;
  rank: string;
  tasks: Task[];
}

export interface BoardMember {
  userId: string;
  role: BoardRole;
  user: User;
}

export interface Board {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  columns?: Column[];
  members?: BoardMember[];
  /** The caller's own role, used to hide mutation affordances for VIEWER —
   *  while the server stays the real gate (PLAN §4). `GET /boards` returns it
   *  on every row; `POST /boards` does **not** (verified against the running
   *  API), so the optimistic insert supplies OWNER itself. */
  role?: BoardRole | null;
  /** Client-only: set on the placeholder row an optimistic create inserts,
   *  cleared when the server's real row is swapped in (PLAN §6). Never sent
   *  to the API. */
  pending?: boolean;
}

/** Cursor pagination on (createdAt, id) — PLAN §2. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
