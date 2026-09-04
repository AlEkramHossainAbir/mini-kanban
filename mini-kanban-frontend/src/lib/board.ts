"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "./api";
import type { Board } from "./types";

/** One key per board, shared by every hook that reads or patches it —
 *  Phase 7/8's optimistic move and Phase 10's WebSocket reconciliation both
 *  address this exact key (PLAN §6). */
export const boardKey = (boardId: string) => ["board", boardId] as const;

/**
 * `GET /boards/:id` — columns and tasks nested, each pre-sorted by the
 * server, plus the caller's own `role` (frontend ROADMAP Phase 6).
 *
 * Does **not** include `members` — that's `GET /boards/:id/members`
 * (`useBoardMembers`, `src/lib/members.ts`), a separate call the header and
 * share modal use directly rather than folding into this cache entry.
 */
export function useBoard(boardId: string) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => get<Board>(`/api/v1/boards/${boardId}`),
    // A 403 (removed mid-session) or 404 (board deleted) won't change on
    // retry — only a transient network/500 error is worth one.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
