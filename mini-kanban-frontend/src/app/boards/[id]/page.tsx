"use client";

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import Link from "next/link";
import { useState } from "react";
import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardHeader } from "@/components/board/BoardHeader";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { DragOverlayCard } from "@/components/board/DragOverlayCard";
import { ShareModal } from "@/components/board/ShareModal";
import { useBoardDnd } from "@/components/board/useBoardDnd";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useBoardMembers } from "@/lib/members";
import { sortByRank } from "@/lib/rank";

/** 340ms `--ease-settle`, exact (`DESIGN §5`/§6) — not the dnd-kit default,
 *  which is the direction's signature "leaves the folder, tips, settles"
 *  drop. The source card stays at .4 opacity as the placeholder while it's
 *  in flight. */
const dropAnimation: DropAnimation = {
  duration: 340,
  easing: "cubic-bezier(.16,1.24,.4,1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

function isDoneColumn(title: string): boolean {
  return title.trim().toLowerCase() === "done";
}

/**
 * The board view (frontend ROADMAP Phase 7 adds drag-and-drop on top of
 * Phase 6's read-only shell; task/column CRUD is still Phase 9).
 * `useQuery(['board', id])` via `useBoard`; columns and tasks are re-sorted
 * client-side by `sortByRank`, the one sort in the app outside an active
 * drag (PLAN §6) — `useBoardDnd` is what supplies the live order during one.
 */
export default function BoardPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [sharing, setSharing] = useState(false);
  const { data: board, isLoading, isError, error, refetch, isRefetching } =
    useBoard(id);
  // Fetched alongside the board (not gated behind opening Share) so the
  // header's avatar stack has something to show as soon as the page does.
  const { data: members } = useBoardMembers(id);
  // Called unconditionally, ahead of the loading/error returns below (rules
  // of hooks) — it's a no-op render-wise until `board` actually exists.
  const dnd = useBoardDnd(board, id);

  if (isLoading) {
    return (
      <div>
        <div className="px-[30px] pt-8">
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
      <div className="mx-auto max-w-[560px] px-[30px] py-16 text-center">
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

  const columns = sortByRank(board.columns ?? []);
  const isOwner = board.role === "OWNER";

  const activeTaskColumn = dnd.activeTask
    ? board.columns?.find((c) => c.id === dnd.activeTask?.columnId)
    : undefined;

  return (
    <div>
      <BoardHeader board={board} members={members} onShare={() => setSharing(true)} />

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
        onDragStart={dnd.handleDragStart}
        onDragOver={dnd.handleDragOver}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        {/* The board's own horizontal scroll container — deliberately never
            the page's, so a mobile swipe across columns can't fight a drag
            (PLAN §6, DESIGN §4.1). */}
        <div className="mt-6 flex gap-[14px] overflow-x-auto px-[30px] pb-8">
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
              />
            ))
          )}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {dnd.activeTask ? (
            <DragOverlayCard
              task={dnd.activeTask}
              done={isDoneColumn(activeTaskColumn?.title ?? "")}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ShareModal
        boardId={id}
        open={sharing}
        onClose={() => setSharing(false)}
        isOwner={isOwner}
      />
    </div>
  );
}
