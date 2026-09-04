"use client";

import {
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMoveColumn } from "@/lib/columns";
import { sortByRank } from "@/lib/rank";
import { useMoveTask, type MoveTaskPayload } from "@/lib/tasks";
import type { Board, Column, Task } from "@/lib/types";

/**
 * A column's own sortable id is prefixed (frontend ROADMAP Phase 9) so it
 * can never collide with that same column's `useDroppable({ id: column.id })`
 * registration in `BoardColumn`'s tray (the drop target tasks land on) —
 * dnd-kit keys its droppable/draggable registries by plain id, and
 * `useSortable` registers both, so reusing the bare column id for the tab's
 * drag handle would silently steal or be stolen by the tray's registration.
 */
const COLUMN_SORT_PREFIX = "col:";
export const columnSortId = (columnId: string) => `${COLUMN_SORT_PREFIX}${columnId}`;
const isColumnSortId = (id: string) => id.startsWith(COLUMN_SORT_PREFIX);
const columnIdFromSortId = (id: string) => id.slice(COLUMN_SORT_PREFIX.length);

/** Column id → ordered task ids. Only exists while a drag is in flight; it
 *  is dnd-kit's live cross-column preview state, kept deliberately separate
 *  from the TanStack Query cache (`sortByRank` stays "the one sort in the
 *  app" — PLAN §6 — for everything *not* mid-drag). */
type DragOrder = Record<string, string[]>;

function baseOrderFrom(board: Board | undefined): DragOrder {
  const order: DragOrder = {};
  for (const column of board?.columns ?? []) {
    order[column.id] = sortByRank(column.tasks).map((t) => t.id);
  }
  return order;
}

function findContainer(order: DragOrder, id: string): string | undefined {
  if (order[id]) return id; // dropped directly on a column's droppable
  return Object.keys(order).find((columnId) => order[columnId].includes(id));
}

/**
 * A column's tab (33px) and its own tray (218px+) are both registered
 * droppables at the same screen position — the tray for tasks, the tab for
 * the column itself (frontend ROADMAP Phase 9). Plain `closestCorners` runs
 * over every droppable regardless of what's being dragged, so a column drag
 * can resolve to a neighbouring tray instead of its tab whenever the tray's
 * corner happens to be marginally nearer — a real, reproducible ambiguity,
 * not just a test artifact (confirmed by an `aria-live` region reading a
 * tray's plain id as `over` mid-drag). Scoping the candidate set to only
 * other columns' tabs when a column is what's being dragged removes the
 * ambiguity entirely; a task drag is unaffected and still considers every
 * droppable, including empty trays (DESIGN §6).
 */
function collisionDetection(...args: Parameters<CollisionDetection>): ReturnType<CollisionDetection> {
  const [{ active, droppableContainers, ...rest }] = args;
  if (!isColumnSortId(String(active.id))) {
    return closestCorners(...args);
  }
  const columnContainers = droppableContainers.filter((c) => isColumnSortId(String(c.id)));
  return closestCorners({ active, droppableContainers: columnContainers, ...rest });
}

/**
 * Drag-and-drop mechanics for the board (frontend ROADMAP Phase 7 — the
 * graded core). Owns the `DndContext` configuration DESIGN §6 requires
 * verbatim, the live cross-column reorder preview, and turning a drop into
 * the neighbour-id payload PLAN §3's move endpoint expects.
 *
 * The optimistic cache write, rollback-on-error, per-task sequence numbers
 * and the post-move Undo toast are `useMoveTask`'s job (`src/lib/tasks.ts`,
 * frontend ROADMAP Phase 8) — this hook only computes the payload (and, for
 * Undo, the pre-move payload to return to) and hands it to that mutation.
 * The drag preview here still owns the *instant* visual feedback; Phase 8's
 * refinements are about the network round trip's edges (conflicts, rapid
 * re-drags), not the drag itself.
 *
 * Frontend ROADMAP Phase 9 adds column reordering on top, in parallel: a
 * column's tab is sortable under its own `col:`-prefixed id (see
 * `columnSortId` above) inside one flat, board-wide `SortableContext`, and
 * every handler here branches on that prefix first. It's deliberately a
 * simpler shape than the task path — one dimension, no cross-container
 * hand-off, no `expectedVersion` (`Column` carries no `version`, PLAN §3) —
 * and hands off to `useMoveColumn` (`src/lib/columns.ts`) the same way the
 * task path hands off to `useMoveTask`.
 */
export function useBoardDnd(board: Board | undefined, boardId: string) {
  const moveTask = useMoveTask(boardId);
  const moveColumn = useMoveColumn(boardId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<DragOrder | null>(null);

  // Snapshot of the dragged task's own starting position, taken once at
  // pickup — compared against the final drop to skip a no-op network call
  // when a card is lifted and set back down exactly where it started.
  const startRef = useRef<{
    taskId: string;
    columnId: string;
    beforeTaskId: string | null;
    afterTaskId: string | null;
  } | null>(null);

  // The column-reorder twin of the task state just above — a flat id order
  // instead of a per-container map, since columns never cross a "board"
  // boundary the way a task crosses columns.
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);
  const columnStartRef = useRef<{
    columnId: string;
    beforeColumnId: string | null;
    afterColumnId: string | null;
  } | null>(null);

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const column of board?.columns ?? []) {
      for (const task of column.tasks) map.set(task.id, task);
    }
    return map;
  }, [board]);

  const sensors = useSensors(
    // Mouse and touch are split deliberately (DESIGN §6): touch needs a
    // delay so a vertical scroll isn't read as a drag, but the same delay
    // on a mouse reads as lag rather than polish.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /** Ordered tasks to render for a column: the live drag preview while
   *  dragging (or settling on a just-committed drop), otherwise plain rank
   *  order — `sortByRank` stays the one sort in the app outside a drag. */
  const tasksForColumn = useCallback(
    (columnId: string): Task[] => {
      if (dragOrder) {
        return (dragOrder[columnId] ?? [])
          .map((id) => taskMap.get(id))
          .filter((t): t is Task => Boolean(t));
      }
      const column = board?.columns?.find((c) => c.id === columnId);
      return column ? sortByRank(column.tasks) : [];
    },
    [dragOrder, board, taskMap]
  );

  /** Ordered columns to render: the live drag preview while a column is
   *  being dragged, otherwise plain rank order — same rule as
   *  `tasksForColumn`, one dimension flatter. */
  const orderedColumns = useCallback(
    (b: Board | undefined): Column[] => {
      if (!b) return [];
      if (columnOrder) {
        const byId = new Map(b.columns?.map((c) => [c.id, c]) ?? []);
        return columnOrder.map((id) => byId.get(id)).filter((c): c is Column => Boolean(c));
      }
      return sortByRank(b.columns ?? []);
    },
    [columnOrder]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const rawId = String(event.active.id);

      if (isColumnSortId(rawId)) {
        const columnId = columnIdFromSortId(rawId);
        const ids = sortByRank(board?.columns ?? []).map((c) => c.id);
        setColumnOrder(ids);
        setActiveColumnId(columnId);

        const index = ids.indexOf(columnId);
        columnStartRef.current = {
          columnId,
          beforeColumnId: index > 0 ? ids[index - 1] : null,
          afterColumnId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
        };
        return;
      }

      const id = rawId;
      const base = baseOrderFrom(board);
      setDragOrder(base);
      setActiveId(id);

      const containerId = findContainer(base, id);
      const ids = containerId ? base[containerId] : [];
      const index = ids.indexOf(id);
      startRef.current = {
        taskId: id,
        columnId: containerId ?? "",
        beforeTaskId: index > 0 ? ids[index - 1] : null,
        afterTaskId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      };
    },
    [board]
  );

  // Moves the active task between columns the instant the pointer crosses a
  // boundary, so the card visually appears in the column it's over while
  // still being dragged. Same-column reordering needs no update here —
  // dnd-kit's own sortable projection previews that from `SortableContext`
  // alone, and `handleDragEnd` below is what actually commits it. A column
  // drag needs no handling here either, for the same reason: it's a single
  // flat `SortableContext`, so dnd-kit's own projection previews it live.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || isColumnSortId(String(active.id))) return;

    setDragOrder((prev) => {
      if (!prev) return prev;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeContainer = findContainer(prev, activeId);
      const overContainer = findContainer(prev, overId);
      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return prev;
      }

      const sourceItems = prev[activeContainer];
      const destItems = prev[overContainer];
      const overIndex = destItems.indexOf(overId);
      const insertAt = overIndex >= 0 ? overIndex : destItems.length;

      return {
        ...prev,
        [activeContainer]: sourceItems.filter((id) => id !== activeId),
        [overContainer]: [
          ...destItems.slice(0, insertAt),
          activeId,
          ...destItems.slice(insertAt),
        ],
      };
    });
  }, []);

  // Clears both the task-drag and column-drag state — only one is ever
  // in flight at once, so resetting both unconditionally is harmless and
  // keeps every exit path (drop, cancel, mutation settle) a one-liner.
  const reset = useCallback(() => {
    setActiveId(null);
    setDragOrder(null);
    startRef.current = null;
    setActiveColumnId(null);
    setColumnOrder(null);
    columnStartRef.current = null;
  }, []);

  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const start = columnStartRef.current;
      setActiveColumnId(null);

      if (!over || !columnOrder || !start) {
        reset();
        return;
      }

      const overRaw = String(over.id);
      if (!isColumnSortId(overRaw)) {
        // Dropped somewhere that isn't another column tab (e.g. a task's
        // tray) — nothing sane to resolve to; bail without a network call.
        reset();
        return;
      }

      const activeColumnId = columnIdFromSortId(String(active.id));
      const overColumnId = columnIdFromSortId(overRaw);
      const oldIndex = columnOrder.indexOf(activeColumnId);
      const newIndex = columnOrder.indexOf(overColumnId);

      let finalOrder = columnOrder;
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        finalOrder = arrayMove(columnOrder, oldIndex, newIndex);
      }
      setColumnOrder(finalOrder);

      const index = finalOrder.indexOf(activeColumnId);
      const beforeColumnId = index > 0 ? finalOrder[index - 1] : null;
      const afterColumnId = index >= 0 && index < finalOrder.length - 1 ? finalOrder[index + 1] : null;

      const unchanged =
        beforeColumnId === start.beforeColumnId && afterColumnId === start.afterColumnId;

      if (unchanged) {
        reset();
        return;
      }

      moveColumn.mutate(
        {
          columnId: activeColumnId,
          payload: { beforeColumnId, afterColumnId },
          optimisticOrder: finalOrder,
        },
        { onSettled: reset }
      );
    },
    [columnOrder, moveColumn, reset]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (isColumnSortId(String(event.active.id))) {
        handleColumnDragEnd(event);
        return;
      }

      const { active, over } = event;
      const start = startRef.current;
      setActiveId(null);

      if (!over || !dragOrder || !start) {
        reset();
        return;
      }

      const activeId = String(active.id);
      const overId = String(over.id);
      const activeContainer = findContainer(dragOrder, activeId);
      const overContainer = findContainer(dragOrder, overId) ?? activeContainer;
      if (!activeContainer || !overContainer) {
        reset();
        return;
      }

      // Same-column reorder commits here via arrayMove; a cross-column move
      // was already applied array-wise by handleDragOver above.
      let finalOrder = dragOrder;
      if (activeContainer === overContainer) {
        const items = dragOrder[activeContainer];
        const oldIndex = items.indexOf(activeId);
        const newIndex = items.indexOf(overId);
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          finalOrder = { ...dragOrder, [activeContainer]: arrayMove(items, oldIndex, newIndex) };
        }
      }
      setDragOrder(finalOrder);

      const targetIds = finalOrder[overContainer] ?? [];
      const index = targetIds.indexOf(activeId);
      const beforeTaskId = index > 0 ? targetIds[index - 1] : null;
      const afterTaskId =
        index >= 0 && index < targetIds.length - 1 ? targetIds[index + 1] : null;

      const unchanged =
        overContainer === start.columnId &&
        beforeTaskId === start.beforeTaskId &&
        afterTaskId === start.afterTaskId;

      const task = taskMap.get(activeId);
      if (unchanged || !task) {
        reset();
        return;
      }

      const payload: MoveTaskPayload = {
        targetColumnId: overContainer,
        beforeTaskId,
        afterTaskId,
        expectedVersion: task.version,
      };

      // Where the card started — carried through so a successful move's
      // toast can offer a symmetric Undo (PLAN §6, frontend ROADMAP Phase 8).
      const undoTo = {
        targetColumnId: start.columnId,
        beforeTaskId: start.beforeTaskId,
        afterTaskId: start.afterTaskId,
      };

      // The drag preview (`finalOrder`) stays rendered — instead of
      // `sortByRank` snapping the card back to its stale server position —
      // until the mutation settles and the cache actually matches it.
      moveTask.mutate(
        { taskId: activeId, payload, undoTo },
        { onSettled: reset }
      );
    },
    [dragOrder, handleColumnDragEnd, moveTask, reset, taskMap]
  );

  const handleDragCancel = useCallback(() => {
    reset();
  }, [reset]);

  const activeTask = activeId ? taskMap.get(activeId) ?? null : null;
  const activeColumn = activeColumnId
    ? board?.columns?.find((c) => c.id === activeColumnId) ?? null
    : null;

  return {
    sensors,
    collisionDetection,
    activeTask,
    activeColumn,
    tasksForColumn,
    orderedColumns,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
