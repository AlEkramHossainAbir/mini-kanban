"use client";

import {
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useMemo, useRef, useState } from "react";
import { sortByRank } from "@/lib/rank";
import { useMoveTask, type MoveTaskPayload } from "@/lib/tasks";
import type { Board, Task } from "@/lib/types";

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
 */
export function useBoardDnd(board: Board | undefined, boardId: string) {
  const moveTask = useMoveTask(boardId);

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

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
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
  // alone, and `handleDragEnd` below is what actually commits it.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

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

  const reset = useCallback(() => {
    setActiveId(null);
    setDragOrder(null);
    startRef.current = null;
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
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
    [dragOrder, moveTask, reset, taskMap]
  );

  const handleDragCancel = useCallback(() => {
    reset();
  }, [reset]);

  const activeTask = activeId ? taskMap.get(activeId) ?? null : null;

  return {
    sensors,
    collisionDetection: closestCorners,
    activeTask,
    tasksForColumn,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
