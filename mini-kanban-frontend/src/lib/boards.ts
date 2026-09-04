"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { get, post } from "./api";
import type { Board, Paginated } from "./types";

/** One key for the whole paginated list — every page lives under it, so an
 *  optimistic write and a rollback both address the same cache entry. */
export const boardsKey = ["boards"] as const;

const PAGE_SIZE = 20;

type BoardsCache = InfiniteData<Paginated<Board>, string | null>;

/**
 * Cursor pagination on `(createdAt, id)` — PLAN §2. The cursor is an opaque
 * base64url string the server encodes; the client never parses it, it only
 * hands the last `nextCursor` back. A `null` `nextCursor` means the last page.
 */
export function useBoards() {
  return useInfiniteQuery({
    queryKey: boardsKey,
    queryFn: ({ pageParam }) =>
      get<Paginated<Board>>(
        `/api/v1/boards?limit=${PAGE_SIZE}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "")
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export interface CreateBoardInput {
  title: string;
  description?: string;
}

function tempId(): string {
  return `temp-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;
}

/** Rewrite exactly one page-0 row, leaving every other page untouched. */
function mapFirstPage(
  cache: BoardsCache,
  fn: (items: Board[]) => Board[]
): BoardsCache {
  return {
    ...cache,
    pages: cache.pages.map((page, i) =>
      i === 0 ? { ...page, items: fn(page.items) } : page
    ),
  };
}

/**
 * Create a board with an optimistic insert (frontend ROADMAP Phase 5).
 *
 * Two rules from PLAN §6 apply here exactly as they do on the board:
 *
 *   - **`cancelQueries` first.** An in-flight background refetch that lands
 *     after the optimistic write would silently overwrite it with the
 *     pre-create list, and the new board would vanish for a moment before
 *     reappearing.
 *   - **Swap the temp id for the real one in place; never append.** Appending
 *     the server's row would leave the placeholder behind and show the board
 *     twice — the duplicate-card bug arriving through the create path.
 *
 * The list is ordered `createdAt desc`, so the newest board belongs at the
 * head of page 0 both optimistically and after the swap. No invalidation
 * follows: refetching would re-page the whole list behind cursors that have
 * already shifted, for a row the swap has already made authoritative.
 */
export function useCreateBoard() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBoardInput) =>
      post<Board>("/api/v1/boards", input),

    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: boardsKey });
      const snapshot = qc.getQueryData<BoardsCache>(boardsKey);
      const id = tempId();

      const now = new Date().toISOString();
      const placeholder: Board = {
        id,
        title: input.title,
        description: input.description?.trim() ? input.description : null,
        // The server derives both of these; the placeholder only has to be
        // plausible for the ~200ms it exists. `ownerId` is unknown here and
        // nothing on this screen reads it.
        ownerId: "",
        createdAt: now,
        updatedAt: now,
        // POST /boards returns no `role`, but the creator is always OWNER —
        // the board and its OWNER membership row are written in one
        // transaction server-side (PLAN §4).
        role: "OWNER",
        pending: true,
      };

      qc.setQueryData<BoardsCache>(boardsKey, (old) =>
        old ? mapFirstPage(old, (items) => [placeholder, ...items]) : old
      );

      return { snapshot, id };
    },

    onError: (_error, _input, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(boardsKey, ctx.snapshot);
    },

    onSuccess: (board, _input, ctx) => {
      qc.setQueryData<BoardsCache>(boardsKey, (old) => {
        if (!old) return old;
        return mapFirstPage(old, (items) =>
          items.map((b) =>
            b.id === ctx.id ? { ...board, role: "OWNER" as const } : b
          )
        );
      });
    },
  });
}
