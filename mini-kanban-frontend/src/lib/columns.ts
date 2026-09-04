"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { del, patch, post } from "./api";
import { boardKey } from "./board";
import { between, first, last, sortByRank } from "./rank";
import type { Board, Column } from "./types";

/**
 * Column CRUD + reorder (frontend ROADMAP Phase 9). Mirrors `src/lib/
 * tasks.ts`'s optimistic-cache discipline (PLAN §6): cancel first, snapshot,
 * apply, keyed by id, roll back on error. `useMoveColumn` mirrors
 * `useMoveTask`'s shape minus the version-conflict machinery — `Column`
 * carries no `version` (PLAN §3), so there's no 409 to reconcile.
 */

function tempColumnId(): string {
  return `temp-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;
}

/** Estimated append-at-end rank for the optimistic placeholder — same
 *  read-half rank port `src/lib/tasks.ts` uses. Never trusted past the round
 *  trip: `useCreateColumn`'s `onSuccess` swaps the whole placeholder for the
 *  server's real row. */
function appendRank(board: Board): string {
  const columns = sortByRank(board.columns ?? []);
  const lowerBound = columns.length ? columns[columns.length - 1].rank : first();
  try {
    return lowerBound < last() ? between(lowerBound, last()) : lowerBound;
  } catch {
    return lowerBound;
  }
}

function appendColumn(board: Board, column: Column): Board {
  return { ...board, columns: [...(board.columns ?? []), column] };
}

/** Swaps a temp-id placeholder for the server's real row, in place — the
 *  "swap, never append" rule (PLAN §6). */
function replaceColumnId(board: Board, tempId: string, real: Column): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) => (c.id === tempId ? real : c)),
  };
}

function patchColumnFields(board: Board, columnId: string, fields: Partial<Column>): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) => (c.id === columnId ? { ...c, ...fields } : c)),
  };
}

function removeColumnFromBoard(board: Board, columnId: string): Board {
  return { ...board, columns: (board.columns ?? []).filter((c) => c.id !== columnId) };
}

/** Reorders `board.columns` to `orderedIds`' order. Any column the caller's
 *  snapshot doesn't know about (shouldn't happen mid-drag) rides along at
 *  the end rather than silently vanishing. */
function reorderColumns(board: Board, orderedIds: string[]): Board {
  const byId = new Map((board.columns ?? []).map((c) => [c.id, c] as const));
  const columns = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is Column => Boolean(c));
  const known = new Set(orderedIds);
  const rest = (board.columns ?? []).filter((c) => !known.has(c.id));
  return { ...board, columns: [...columns, ...rest] };
}

/**
 * `POST /boards/:id/columns` with the same tempId + `pending` + swap-in-place
 * optimistic insert `useCreateTask`/`useCreateBoard` use. The server response
 * is a bare `Column` row with no `tasks` array — the swap supplies an empty
 * one, which is sound: a column that didn't exist a moment ago can't yet
 * hold a card.
 */
export function useCreateColumn(boardId: string) {
  const qc = useQueryClient();

  return useMutation<
    Column,
    Error,
    { title: string },
    { previousBoard?: Board; id: string }
  >({
    mutationFn: ({ title }) => post<Column>(`/api/v1/boards/${boardId}/columns`, { title }),

    onMutate: async ({ title }) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      const id = tempColumnId();

      if (previousBoard) {
        const placeholder: Column = {
          id,
          boardId,
          title,
          rank: appendRank(previousBoard),
          tasks: [],
          pending: true,
        };
        qc.setQueryData<Board>(boardKey(boardId), appendColumn(previousBoard, placeholder));
      }

      return { previousBoard, id };
    },

    onError: (_error, _vars, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not add that column.");
    },

    onSuccess: (column, _vars, ctx) => {
      qc.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? replaceColumnId(old, ctx.id, { ...column, tasks: [] }) : old
      );
    },
  });
}

/** `PATCH /columns/:id` — rename only. */
export function useRenameColumn(boardId: string) {
  const qc = useQueryClient();

  return useMutation<
    Column,
    Error,
    { columnId: string; title: string },
    { previousBoard?: Board }
  >({
    mutationFn: ({ columnId, title }) => patch<Column>(`/api/v1/columns/${columnId}`, { title }),

    onMutate: async ({ columnId, title }) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      if (previousBoard) {
        qc.setQueryData<Board>(
          boardKey(boardId),
          patchColumnFields(previousBoard, columnId, { title })
        );
      }
      return { previousBoard };
    },

    onError: (_error, _vars, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not rename that column.");
    },
  });
}

/** `DELETE /columns/:id` — cascades its tasks server-side, no undo (PLAN
 *  §6), which is why the UI gates this behind a confirm dialog. */
export function useDeleteColumn(boardId: string) {
  const qc = useQueryClient();

  return useMutation<void, Error, string, { previousBoard?: Board }>({
    mutationFn: (columnId) => del(`/api/v1/columns/${columnId}`),

    onMutate: async (columnId) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      if (previousBoard) {
        qc.setQueryData<Board>(boardKey(boardId), removeColumnFromBoard(previousBoard, columnId));
      }
      return { previousBoard };
    },

    onError: (_error, _columnId, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not delete that column.");
    },
  });
}

export interface MoveColumnPayload {
  beforeColumnId?: string | null;
  afterColumnId?: string | null;
}

export interface MoveColumnVariables {
  columnId: string;
  payload: MoveColumnPayload;
  /** Full column-id order after this move — computed by the caller
   *  (`useBoardDnd`, which already derived it from the drop), used only for
   *  the optimistic cache write below; the payload sent over the wire is
   *  just the neighbour ids. */
  optimisticOrder: string[];
}

export interface MoveColumnResult {
  id: string;
  boardId: string;
  title: string;
  rank: string;
}

/**
 * `PATCH /columns/:id/move` (frontend ROADMAP Phase 9). Same optimistic-
 * write/rollback shape as `useMoveTask`, minus the version-conflict
 * machinery: `Column` has no `version` (PLAN §3 — that rigor is task move's
 * job, the graded core), so there's no 409 path to reconcile here.
 */
export function useMoveColumn(boardId: string) {
  const qc = useQueryClient();

  return useMutation<
    MoveColumnResult,
    Error,
    MoveColumnVariables,
    { previousBoard?: Board }
  >({
    mutationFn: ({ columnId, payload }) =>
      patch<MoveColumnResult>(`/api/v1/columns/${columnId}/move`, payload),

    onMutate: async ({ optimisticOrder }) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      if (previousBoard) {
        qc.setQueryData<Board>(boardKey(boardId), reorderColumns(previousBoard, optimisticOrder));
      }
      return { previousBoard };
    },

    onError: (_error, _vars, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not reorder that column.");
    },

    onSuccess: (result) => {
      qc.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? patchColumnFields(old, result.id, { rank: result.rank }) : old
      );
    },
  });
}
