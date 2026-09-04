"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { ApiError, del, patch, post } from "./api";
import { boardKey } from "./board";
import { between, first, last, sortByRank } from "./rank";
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

/** Finds `taskId`'s current `rank`, searching every column — a move's
 *  neighbour ids can name a task outside the target column's own array
 *  (dnd-kit's cross-column preview already relocated it there visually,
 *  ahead of any cache write). */
function rankOf(board: Board, taskId: string): string | undefined {
  for (const column of board.columns ?? []) {
    const task = column.tasks.find((t) => t.id === taskId);
    if (task) return task.rank;
  }
  return undefined;
}

/**
 * A best-effort rank for the optimistic cache write below — the read half of
 * `mini-kanban-backend/src/tasks/rank.util.ts`'s `between()`, ported to
 * `src/lib/rank.ts` for exactly this. Never trusted past the round trip:
 * `useMoveTask`'s `onSuccess` always overwrites it with the server's real
 * `rank`. Falls back to the sentinel bounds a stale/unknown neighbour id
 * would resolve to server-side (self-healing, PLAN §3) and, on any failure
 * (e.g. colliding ranks), to the task's own current rank — this estimate is
 * cosmetic, not worth surfacing an error over.
 */
function optimisticRank(
  board: Board,
  task: Task,
  payload: MoveTaskPayload
): string {
  try {
    const lower = (payload.beforeTaskId && rankOf(board, payload.beforeTaskId)) || first();
    const upper = (payload.afterTaskId && rankOf(board, payload.afterTaskId)) || last();
    if (lower >= upper) return task.rank;
    return between(lower, upper);
  } catch {
    return task.rank;
  }
}

/**
 * The optimistic half of a move (PLAN §6 step 1–2): relocates `taskId` to
 * `payload.targetColumnId` at an estimated rank and bumps its version by
 * one, via the same keyed upsert `onSuccess`/a 409's `currentTask` reconcile
 * through — so there is exactly one code path that ever moves a task between
 * a board's column arrays.
 */
export function moveTaskOptimistic(
  board: Board,
  taskId: string,
  payload: MoveTaskPayload
): Board {
  let task: Task | undefined;
  for (const column of board.columns ?? []) {
    task = column.tasks.find((t) => t.id === taskId);
    if (task) break;
  }
  if (!task) return board;

  return upsertTaskInBoard(board, {
    id: task.id,
    columnId: payload.targetColumnId,
    rank: optimisticRank(board, task, payload),
    version: task.version + 1,
    updatedAt: new Date().toISOString(),
  });
}

export interface MoveTaskVariables {
  taskId: string;
  payload: MoveTaskPayload;
  /** The task's neighbours and column *before* this move, captured at drag
   *  start (`useBoardDnd`) — carried through so a successful move's toast can
   *  offer a symmetric Undo: this same mutation, called again with these as
   *  the new target (PLAN §6). Omitted (e.g. an Undo call itself) means no
   *  further Undo is offered — undoing an undo isn't in PLAN §6's scope. */
  undoTo?: Omit<MoveTaskPayload, "expectedVersion">;
}

interface MoveTaskContext {
  previousBoard: Board | undefined;
  /** This call's stamp in `sequenceRef` — PLAN §6's per-task sequence
   *  number. Guards both `onError`'s rollback and `onSuccess`'s reconcile:
   *  if a *newer* call for the same task has started since (a rapid
   *  re-drag), this one's response is stale and must not stomp what that
   *  newer call has already written. */
  sequence: number;
}

/**
 * `PATCH /tasks/:id/move` (frontend ROADMAP Phase 7's client half; Phase 8
 * adds the optimism below). `useBoardDnd`'s drag preview already gives
 * instant *visual* feedback via its own `dragOrder` state, kept deliberately
 * separate from this cache — this hook's job is PLAN §6's full contract:
 * apply the move to the TanStack Query cache itself (so anything reading it
 * directly, not through the drag preview, is never stale), roll back to a
 * snapshot on failure, and reconcile with the server's authoritative
 * `rank`/`version` on success.
 */
export function useMoveTask(boardId: string) {
  const queryClient = useQueryClient();

  // One counter per task id, not a single global counter — two different
  // cards being dragged in quick succession must not make each other's
  // responses look stale.
  const sequenceRef = useRef(new Map<string, number>());
  const nextSequence = (taskId: string): number => {
    const seq = (sequenceRef.current.get(taskId) ?? 0) + 1;
    sequenceRef.current.set(taskId, seq);
    return seq;
  };
  const isCurrent = (taskId: string, seq: number): boolean =>
    sequenceRef.current.get(taskId) === seq;

  // `onSuccess`'s Undo action re-enters this very mutation. `useMutation`'s
  // own config can't reference the object it returns, so the object is
  // stashed here and read back through the ref — by the time `onSuccess`
  // actually runs (after this function has returned the mutation to its
  // caller), `mutationRef.current` is always set.
  const mutationRef = useRef<UseMutationResult<
    MoveTaskResult,
    Error,
    MoveTaskVariables,
    MoveTaskContext
  > | null>(null);

  const mutation = useMutation<MoveTaskResult, Error, MoveTaskVariables, MoveTaskContext>({
    mutationFn: ({ taskId, payload }) => moveTaskRequest(taskId, payload),

    onMutate: async ({ taskId, payload }) => {
      // Without this, an in-flight refetch from before the drag (or React
      // Query's own refetch-on-focus) can land after the optimistic write
      // and silently overwrite it with pre-drag data — PLAN §6's named
      // mechanism behind "card jumps back even though the move succeeded."
      await queryClient.cancelQueries({ queryKey: boardKey(boardId) });

      const previousBoard = queryClient.getQueryData<Board>(boardKey(boardId));
      const sequence = nextSequence(taskId);

      if (previousBoard) {
        queryClient.setQueryData<Board>(
          boardKey(boardId),
          moveTaskOptimistic(previousBoard, taskId, payload)
        );
      }

      return { previousBoard, sequence };
    },

    onError: (error, { taskId }, context) => {
      // A newer call for this task has already taken over — this failure is
      // for a move the user has since moved past; don't stomp its state.
      if (!context || !isCurrent(taskId, context.sequence)) return;

      queryClient.setQueryData(boardKey(boardId), context.previousBoard);

      if (error instanceof ApiError && error.isConflict) {
        const currentTask = (
          error.body as { currentTask?: MoveTaskResult } | null
        )?.currentTask;
        if (currentTask) {
          queryClient.setQueryData<Board>(boardKey(boardId), (old) =>
            old ? upsertTaskInBoard(old, currentTask) : old
          );
        }
        toast.error("Someone else moved this task — board updated");
      } else {
        toast.error("Couldn't move that card");
      }
    },

    onSuccess: (result, { taskId, undoTo }, context) => {
      if (!context || !isCurrent(taskId, context.sequence)) return;

      queryClient.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? upsertTaskInBoard(old, result) : old
      );

      if (undoTo) {
        toast.success("Card moved", {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              mutationRef.current?.mutate({
                taskId,
                payload: { ...undoTo, expectedVersion: result.version },
                // No further Undo offered on the undo itself.
              });
            },
          },
        });
      }
    },
  });

  mutationRef.current = mutation;
  return mutation;
}

// ---------------------------------------------------------------------------
// Task CRUD (frontend ROADMAP Phase 9). The move endpoint above is its own
// thing (PLAN §3's graded core); these three are the plain create/edit/delete
// paths — same optimistic-cache discipline (PLAN §6), no version/rank rigor.
// ---------------------------------------------------------------------------

function tempTaskId(): string {
  return `temp-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;
}

function findColumn(board: Board, columnId: string) {
  return board.columns?.find((c) => c.id === columnId);
}

/** Appends a task to one column's array — used for both a freshly-created
 *  placeholder and (defensively) the server's real row, never sorted here;
 *  `sortByRank` is the one thing that decides render order (PLAN §6). */
function appendTaskToColumn(board: Board, columnId: string, task: Task): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) =>
      c.id === columnId ? { ...c, tasks: [...c.tasks, task] } : c
    ),
  };
}

/** Swaps a temp-id placeholder for the server's real row, in place — the
 *  same "swap, never append" rule `useCreateBoard` uses (PLAN §6): appending
 *  the real row instead would leave the placeholder behind and double the
 *  card. */
function replaceTaskId(board: Board, tempId: string, real: Task): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === tempId ? real : t)),
    })),
  };
}

function removeTaskFromBoard(board: Board, taskId: string): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) => ({
      ...c,
      tasks: c.tasks.filter((t) => t.id !== taskId),
    })),
  };
}

function patchTaskFields(board: Board, taskId: string, fields: Partial<Task>): Board {
  return {
    ...board,
    columns: (board.columns ?? []).map((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...fields } : t)),
    })),
  };
}

/** Estimated append-at-end rank for an optimistic placeholder — the same
 *  read-half rank port `optimisticRank` above leans on. Never trusted past
 *  the round trip: the create mutation's `onSuccess` swaps the whole
 *  placeholder for the server's real row, rank included. */
function appendRank(board: Board, columnId: string): string {
  const column = findColumn(board, columnId);
  const tasks = column ? sortByRank(column.tasks) : [];
  const lowerBound = tasks.length ? tasks[tasks.length - 1].rank : first();
  try {
    return lowerBound < last() ? between(lowerBound, last()) : lowerBound;
  } catch {
    return lowerBound;
  }
}

export interface CreateTaskInput {
  columnId: string;
  title: string;
  description?: string;
}

/**
 * `POST /columns/:id/tasks` with an optimistic insert (frontend ROADMAP
 * Phase 9) — the tempId + `pending` + swap-in-place shape `useCreateBoard`
 * established for exactly this reason (PLAN §6).
 */
export function useCreateTask(boardId: string) {
  const qc = useQueryClient();

  return useMutation<
    Task,
    Error,
    CreateTaskInput,
    { previousBoard?: Board; id: string }
  >({
    mutationFn: ({ columnId, title, description }) =>
      post<Task>(`/api/v1/columns/${columnId}/tasks`, { title, description }),

    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      const id = tempTaskId();

      if (previousBoard) {
        const now = new Date().toISOString();
        const placeholder: Task = {
          id,
          columnId: input.columnId,
          boardId,
          title: input.title,
          description: input.description?.trim() ? input.description : null,
          rank: appendRank(previousBoard, input.columnId),
          version: 0,
          createdAt: now,
          updatedAt: now,
          pending: true,
        };
        qc.setQueryData<Board>(
          boardKey(boardId),
          appendTaskToColumn(previousBoard, input.columnId, placeholder)
        );
      }

      return { previousBoard, id };
    },

    onError: (_error, _input, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not add that card.");
    },

    onSuccess: (task, _input, ctx) => {
      qc.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? replaceTaskId(old, ctx.id, task) : old
      );
    },
  });
}

export interface UpdateTaskInput {
  taskId: string;
  title: string;
  description?: string;
}

/** `PATCH /tasks/:id` — title/description only (PLAN §3); never touches
 *  `rank`/`columnId`/`version`, which stay the move endpoint's job above. */
export function useUpdateTask(boardId: string) {
  const qc = useQueryClient();

  return useMutation<Task, Error, UpdateTaskInput, { previousBoard?: Board }>({
    mutationFn: ({ taskId, title, description }) =>
      patch<Task>(`/api/v1/tasks/${taskId}`, { title, description }),

    onMutate: async ({ taskId, title, description }) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      if (previousBoard) {
        qc.setQueryData<Board>(
          boardKey(boardId),
          patchTaskFields(previousBoard, taskId, {
            title,
            description: description?.trim() ? description : null,
            updatedAt: new Date().toISOString(),
          })
        );
      }
      return { previousBoard };
    },

    onError: (_error, _vars, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not save that card.");
    },

    onSuccess: (task) => {
      qc.setQueryData<Board>(boardKey(boardId), (old) =>
        old ? patchTaskFields(old, task.id, task) : old
      );
    },
  });
}

/** `DELETE /tasks/:id` — no undo (PLAN §6), which is why the UI gates this
 *  behind a confirm dialog rather than firing on a bare click. */
export function useDeleteTask(boardId: string) {
  const qc = useQueryClient();

  return useMutation<void, Error, string, { previousBoard?: Board }>({
    mutationFn: (taskId) => del(`/api/v1/tasks/${taskId}`),

    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: boardKey(boardId) });
      const previousBoard = qc.getQueryData<Board>(boardKey(boardId));
      if (previousBoard) {
        qc.setQueryData<Board>(boardKey(boardId), removeTaskFromBoard(previousBoard, taskId));
      }
      return { previousBoard };
    },

    onError: (_error, _taskId, ctx) => {
      if (ctx?.previousBoard) qc.setQueryData(boardKey(boardId), ctx.previousBoard);
      toast.error("Could not delete that card.");
    },
  });
}
