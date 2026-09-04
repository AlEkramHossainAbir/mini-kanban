"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, patch } from "./api";
import { boardKey } from "./board";
import type { Board, Task } from "./types";

/** PLAN §3's move payload — the neighbour-id shape, not a raw index (frontend
 *  ROADMAP Phase 7). `position` exists server-side too, but the UI always
 *  knows the two cards it dropped between, so it never needs that fallback. */
export interface MoveTaskPayload {
  targetColumnId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
  expectedVersion: number;
}

/** The move endpoint's response — and a 409's `currentTask` — both carry
 *  only this fixed, minimal shape (PLAN §3's `MOVE_RESULT_SELECT`), never
 *  the full `Task`. Merging it onto the cached row (below) rather than
 *  replacing that row wholesale is what keeps `title`/`description`/
 *  `createdAt` from being wiped out by every move. */
export interface MoveTaskResult {
  id: string;
  columnId: string;
  rank: string;
  version: number;
  updatedAt: string;
}

function moveTaskRequest(taskId: string, payload: MoveTaskPayload) {
  return patch<MoveTaskResult>(`/api/v1/tasks/${taskId}/move`, payload);
}

/**
 * Keyed upsert (PLAN §6): merges one task's updated fields in by id,
 * wherever it currently lives, rather than replacing the board wholesale
 * *or* the task wholesale. Used to reconcile both a successful move
 * response and a 409's `currentTask` — both `MoveTaskResult`, not a full
 * `Task` (see above).
 *
 * Deliberately preserves each column's existing array order and only
 * patches the moved task's own fields — the drag preview (`useBoardDnd`)
 * has already put every task in its visually-final position by the time
 * this runs, and `sortByRank` re-derives render order from `rank` alone, so
 * this never needs to know *where* in the array to put the row back.
 */
export function upsertTaskInBoard(board: Board, patch: MoveTaskResult): Board {
  let existing: Task | undefined;
  for (const column of board.columns ?? []) {
    existing = column.tasks.find((t) => t.id === patch.id);
    if (existing) break;
  }
  if (!existing) return board;

  const merged: Task = { ...existing, ...patch };
  const columns = (board.columns ?? []).map((column) => {
    const hasTask = column.tasks.some((t) => t.id === merged.id);
    if (column.id === merged.columnId) {
      return {
        ...column,
        tasks: hasTask
          ? column.tasks.map((t) => (t.id === merged.id ? merged : t))
          : [...column.tasks, merged],
      };
    }
    return hasTask
      ? { ...column, tasks: column.tasks.filter((t) => t.id !== merged.id) }
      : column;
  });
  return { ...board, columns };
}

/**
 * `PATCH /tasks/:id/move` (frontend ROADMAP Phase 7 — the graded core's
 * client half). `useBoardDnd` already commits the visual reorder the moment
 * a card is dropped; this hook's job is to persist that and reconcile the
 * cache with whatever the server actually decided (rank/version), via the
 * keyed upsert above.
 *
 * This is deliberately the plain, non-optimistic form of the mutation — no
 * `onMutate` snapshot/rollback, no per-task sequence numbers, no undo. Those
 * are frontend ROADMAP Phase 8's job; here the drag preview already gives
 * the instant feedback, and `onError` below falls back to a full board
 * refetch rather than a surgical rollback.
 */
export function useMoveTask(boardId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: MoveTaskPayload;
    }) => moveTaskRequest(taskId, payload),
    onSuccess: (result) => {
      queryClient.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? upsertTaskInBoard(old, result) : old
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isConflict) {
        const currentTask = (
          error.body as { currentTask?: MoveTaskResult } | null
        )?.currentTask;
        if (currentTask) {
          queryClient.setQueryData<Board>(boardKey(boardId), (old) =>
            old ? upsertTaskInBoard(old, currentTask) : old
          );
        } else {
          queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
        }
        toast.error("Someone else moved this task — board updated");
      } else {
        queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
        toast.error("Couldn't move that card");
      }
    },
  });
}
