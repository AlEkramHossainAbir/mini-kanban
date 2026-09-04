"use client";

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DropAnimation,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AddColumnButton } from "@/components/board/AddColumnButton";
import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardHeader } from "@/components/board/BoardHeader";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { ColumnDragOverlay } from "@/components/board/ColumnDragOverlay";
import { DragOverlayCard } from "@/components/board/DragOverlayCard";
import { columnSortId, useBoardDnd } from "@/components/board/useBoardDnd";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useBoardMembers } from "@/lib/members";
import { usePrefersReducedMotion } from "@/lib/motion";
import { useBoardRealtime } from "@/lib/realtime";
import type { Board, Task } from "@/lib/types";

/** Neither modal is needed for the board's initial paint — react-hook-form
 *  + zod are already in the shared chunk (login/register pull them in too),
 *  but each modal's own component code (and, for `ShareModal`, the member
 *  list query) only has to load once a viewer actually opens one. Lazy per
 *  `DESIGN §8`'s < 200KB budget, which Phase 9 left over (frontend ROADMAP
 *  Phase 11's own budget note). Neither renders anything server-side by
 *  design — both are conditionally mounted, client-only overlays. */
const ShareModal = dynamic(
  () => import("@/components/board/ShareModal").then((m) => m.ShareModal),
  { ssr: false }
);
const EditTaskModal = dynamic(
  () => import("@/components/board/EditTaskModal").then((m) => m.EditTaskModal),
  { ssr: false }
);

function isDoneColumn(title: string): boolean {
  return title.trim().toLowerCase() === "done";
}

/** DESIGN §7 — keyboard drag is graded and must announce the task/column
 *  name and the resulting position, not just "moved". `dnd-kit`'s own
 *  default announcements only ever say "was moved", which tells a
 *  screen-reader user nothing about where it landed. Position counts read
 *  off the live drag-preview order in `useBoardDnd` (`dnd.tasksForColumn`/
 *  `dnd.orderedColumns`), the same order actually on screen mid-drag. */
function buildAnnouncements(
  board: Board,
  dnd: ReturnType<typeof useBoardDnd>
): Announcements {
  const columnTitle = (columnId: string) =>
    board.columns?.find((c) => c.id === columnId)?.title ?? "a column";

  return {
    onDragStart({ active }) {
      const id = String(active.id);
      if (id.startsWith("col:")) {
        const columnId = id.slice("col:".length);
        return `Picked up column "${columnTitle(columnId)}".`;
      }
      const task = dnd.activeTask;
      return `Picked up card "${task?.title ?? "task"}".`;
    },
    onDragOver({ active, over }) {
      if (!over) return undefined;
      const id = String(active.id);
      if (id.startsWith("col:")) {
        const columns = dnd.orderedColumns(board);
        const index = columns.findIndex((c) => columnSortId(c.id) === id);
        if (index < 0) return undefined;
        return `Column "${columnTitle(
          columns[index].id
        )}" moved to position ${index + 1} of ${columns.length}.`;
      }
      const overContainerId =
        board.columns?.find((c) => c.id === String(over.id))?.id ??
        board.columns?.find((c) => c.tasks?.some((t) => t.id === String(over.id)))?.id;
      if (!overContainerId) return undefined;
      const tasks = dnd.tasksForColumn(overContainerId);
      const index = tasks.findIndex((t) => t.id === id);
      if (index < 0) return undefined;
      return `Card "${tasks[index].title}" moved to ${columnTitle(
        overContainerId
      )}, position ${index + 1} of ${tasks.length}.`;
    },
    onDragEnd({ active, over }) {
      const id = String(active.id);
      if (!over) {
        return id.startsWith("col:")
          ? "Column drag cancelled."
          : "Card drag cancelled.";
      }
      if (id.startsWith("col:")) {
        const columnId = id.slice("col:".length);
        return `Column "${columnTitle(columnId)}" dropped.`;
      }
      const task = board.columns
        ?.flatMap((c) => c.tasks ?? [])
        .find((t) => t.id === id);
      return `Card "${task?.title ?? "task"}" dropped.`;
    },
    onDragCancel({ active }) {
      const id = String(active.id);
      return id.startsWith("col:") ? "Column drag cancelled." : "Card drag cancelled.";
    },
  };
}

/**
 * The board view (frontend ROADMAP Phase 7 added drag-and-drop on top of
 * Phase 6's read-only shell; Phase 9 adds task/column CRUD and column
 * reordering on top of that). `useQuery(['board', id])` via `useBoard`;
 * `useBoardDnd` supplies render order for both columns and tasks — plain
 * rank order outside an active drag, the live drag preview during one
 * (PLAN §6's "the one sort in the app," now one dimension wider).
 */
export default function BoardPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [sharing, setSharing] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const { data: board, isLoading, isError, error, refetch, isRefetching } =
    useBoard(id);
  // Fetched alongside the board (not gated behind opening Share) so the
  // header's avatar stack has something to show as soon as the page does.
  const { data: members } = useBoardMembers(id);
  // Called unconditionally, ahead of the loading/error returns below (rules
  // of hooks) — it's a no-op render-wise until `board` actually exists.
  const dnd = useBoardDnd(board, id);
  // Same reason: connects/joins the room as soon as the page mounts, not
  // gated on `board` having loaded yet.
  const realtimeStatus = useBoardRealtime(id);
  const reducedMotion = usePrefersReducedMotion();

  // 340ms `--ease-settle`, exact (`DESIGN §5`/§6) — not the dnd-kit default,
  // which is the direction's signature "leaves the folder, tips, settles"
  // drop. The source card stays at .4 opacity as the placeholder while it's
  // in flight. Collapses to ≤1ms under reduced motion (DESIGN §5 rule 3) —
  // dnd-kit drives this via the Web Animations API, so the CSS-transition
  // override in globals.css can't reach it; see `src/lib/motion.ts`.
  const dropAnimation: DropAnimation = useMemo(
    () => ({
      duration: reducedMotion ? 1 : 340,
      easing: reducedMotion ? "linear" : "cubic-bezier(.16,1.24,.4,1)",
      sideEffects: defaultDropAnimationSideEffects({
        styles: { active: { opacity: "0.4" } },
      }),
    }),
    [reducedMotion]
  );

  if (isLoading) {
    return (
      <div>
        <div className="px-[var(--gutter)] pt-8">
          <div className="h-3.5 w-24 animate-pulse rounded-[2px] bg-[rgba(255,255,255,.12)]" />
          <div className="mt-2 h-9 w-72 animate-pulse rounded-[2px] bg-[rgba(255,255,255,.12)]" />
        </div>
        <BoardSkeleton />
      </div>
    );
  }

  if (isError) {
    const status = error instanceof ApiError ? error.status : undefined;
    const notYours = status === 403 || status === 404;

    return (
      <div className="mx-auto max-w-[560px] px-[var(--gutter)] py-16 text-center">
        <p className="font-archivo text-[18px] font-bold text-[#F6EFE3]">
          {notYours ? "This board isn't available" : "Could not load this board"}
        </p>
        <p className="mt-2 font-courier text-[12.5px] text-[rgba(255,240,220,.6)]">
          {notYours
            ? "It may have been deleted, or your access was removed."
            : "Something went wrong reaching the API."}
        </p>
        {notYours ? (
          <Link href="/boards">
            <Button variant="desk" className="mt-5">
              Back to your boards
            </Button>
          </Link>
        ) : (
          <Button
            variant="desk"
            className="mt-5"
            loading={isRefetching}
            onClick={() => refetch()}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  // isLoading/isError above already cover every non-success state, but
  // they aren't the query's actual discriminant field, so TS can't narrow
  // `data` through them — this is that narrowing, not a real fallback path.
  if (!board) return null;

  const columns = dnd.orderedColumns(board);
  const isOwner = board.role === "OWNER";
  // VIEWER gets a read-only board (PLAN §4) — the server is the real gate on
  // every mutating route; this only decides whether Phase 9's affordances
  // (add/rename/delete, column drag) render at all.
  const canEdit = board.role === "OWNER" || board.role === "EDITOR";

  const activeTaskColumn = dnd.activeTask
    ? board.columns?.find((c) => c.id === dnd.activeTask?.columnId)
    : undefined;

  return (
    <div>
      <BoardHeader
        board={board}
        members={members}
        onShare={() => setSharing(true)}
        realtimeStatus={realtimeStatus}
      />

      {/* Drag-and-drop, the graded core (frontend ROADMAP Phase 7,
          DESIGN §6's contract): `MeasuringStrategy.Always` (not the
          default — otherwise the drop gap opens in a stale spot after the
          first reorder) and `closestCorners` (centre-distance collisions
          misbehave with variable card heights and can't reach empty
          columns). */}
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        // DESIGN §7 — keyboard drag must announce the task/column name and
        // where it landed, not dnd-kit's default "was moved".
        accessibility={{ announcements: buildAnnouncements(board, dnd) }}
        onDragStart={dnd.handleDragStart}
        onDragOver={dnd.handleDragOver}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        {/* The board's own horizontal scroll container — deliberately never
            the page's, so a mobile swipe across columns can't fight a drag
            (PLAN §6, DESIGN §4.1). One flat `SortableContext` over the
            column ids (frontend ROADMAP Phase 9) sits alongside each
            column's own vertical task context — the two never overlap
            because a column's own drag-handle id is prefixed (`columnSortId`,
            `useBoardDnd`), so there's no id collision between the two
            contexts. */}
        <div className="mt-6 flex gap-[14px] overflow-x-auto px-[var(--gutter)] pb-8">
          <SortableContext
            items={columns.map((c) => columnSortId(c.id))}
            strategy={horizontalListSortingStrategy}
          >
            {columns.length === 0 ? (
              <p className="font-courier text-[12.5px] text-[rgba(255,240,220,.6)]">
                no columns filed yet
              </p>
            ) : (
              columns.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={dnd.tasksForColumn(column.id)}
                  boardId={id}
                  canEdit={canEdit}
                  onEditTask={setEditingTask}
                />
              ))
            )}
          </SortableContext>

          {canEdit && <AddColumnButton boardId={id} />}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {dnd.activeTask ? (
            <DragOverlayCard
              task={dnd.activeTask}
              done={isDoneColumn(activeTaskColumn?.title ?? "")}
            />
          ) : dnd.activeColumn ? (
            <ColumnDragOverlay column={dnd.activeColumn} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ShareModal
        boardId={id}
        open={sharing}
        onClose={() => setSharing(false)}
        isOwner={isOwner}
      />

      <EditTaskModal
        task={editingTask}
        boardId={id}
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
      />
    </div>
  );
}
