"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { useDeleteColumn, useRenameColumn } from "@/lib/columns";
import { sortableTransition, usePrefersReducedMotion } from "@/lib/motion";
import type { Column, Task } from "@/lib/types";
import { columnSortId } from "./useBoardDnd";
import { TaskCard } from "./TaskCard";
import { TaskComposer } from "./TaskComposer";

/** Status colour lives in the tab gradient and nowhere else (`DESIGN §4.2`).
 *  Matched case-insensitively against the column's own title; anything not
 *  in the table — including "Backlog"/"In review", which the table already
 *  maps to the default — falls through to the same default gradient. */
const TAB_GRADIENT: Record<string, [string, string]> = {
  "in progress": ["#E0C793", "#CFB37C"],
  blocked: ["#DBB6A4", "#C99C87"],
  done: ["#C4CDA8", "#AEB98E"],
};
const DEFAULT_GRADIENT: [string, string] = ["var(--manila)", "var(--manila-2)"];

export function gradientFor(title: string): [string, string] {
  return TAB_GRADIENT[title.trim().toLowerCase()] ?? DEFAULT_GRADIENT;
}

function isDoneColumn(title: string): boolean {
  return title.trim().toLowerCase() === "done";
}

/**
 * A column: the angle-cut manila tab (`DESIGN §4.2`) over the tray
 * (`DESIGN §4.3`). Drag (task and, as of frontend ROADMAP Phase 9, the
 * column itself) lands here; Phase 9 also adds rename/delete on the tab and
 * an "add a card" composer at the tray's foot.
 *
 * `tasks` is passed in already ordered by the caller (`BoardPage`, via
 * `useBoardDnd`) rather than derived here from `column.tasks` — mid-drag
 * that order is the live cross-column preview, not plain rank order, and
 * this component doesn't need to know the difference.
 *
 * The tray gets its own vertical scroll, capped independently of the
 * board's horizontal strip (`PLAN §6` / `DESIGN §4.1) — the two must never
 * share a scroll container, or a mobile swipe to see more columns fights a
 * vertical swipe to see more cards in one.
 */
export function BoardColumn({
  column,
  tasks,
  boardId,
  canEdit,
  onEditTask,
}: {
  column: Column;
  tasks: Task[];
  boardId: string;
  /** VIEWER gets a read-only board (PLAN §4) — the server is the real gate;
   *  this only decides whether to render the affordances at all. */
  canEdit: boolean;
  onEditTask: (task: Task) => void;
}) {
  const [from, to] = gradientFor(column.title);
  const done = isDoneColumn(column.title);
  const taskIds = tasks.map((t) => t.id);
  const pending = column.pending === true;

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const renameColumn = useRenameColumn(boardId);
  const deleteColumn = useDeleteColumn(boardId);

  // The whole tray is the droppable, including when it holds zero cards
  // (DESIGN §4.3) — the single most common dnd-kit Kanban bug is an empty
  // column having nothing to hit. Kept at the plain `column.id` — the
  // column's own drag handle below registers under a distinct, prefixed id
  // (see `columnSortId`'s docblock) so the two never collide.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  const reducedMotion = usePrefersReducedMotion();

  // The tab itself is the column's drag handle — no separate grip
  // affordance, matching how a card is its own handle (DESIGN §7).
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnSortId(column.id),
    disabled: !canEdit || pending,
    data: { type: "column" },
    // DESIGN §5's 280ms reflow, not dnd-kit's 200ms/ease default — see
    // `src/lib/motion.ts`.
    transition: sortableTransition(reducedMotion),
  });

  useEffect(() => {
    if (!renaming) setDraft(column.title);
  }, [column.title, renaming]);

  const startRename = () => {
    setDraft(column.title);
    setRenaming(true);
  };

  const commitRename = () => {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === column.title) return;
    renameColumn.mutate({ columnId: column.id, title });
  };

  const showEditButtons = canEdit && !pending && !renaming;

  return (
    <div
      ref={setSortableRef}
      className="relative flex w-[var(--col-w)] flex-shrink-0 flex-col"
      aria-busy={pending || undefined}
      style={{
        opacity: isDragging ? 0.4 : pending ? 0.6 : undefined,
        transform: CSS.Transform.toString(transform),
        transition,
        willChange: isDragging ? "transform" : undefined,
      }}
    >
      <div
        {...attributes}
        {...(renaming ? {} : listeners)}
        className="flex w-full items-center gap-2 self-start rounded-tab shadow-[0_-1px_0_rgba(255,255,255,.4)_inset]"
        style={{
          background: `linear-gradient(${from},${to})`,
          clipPath: renaming ? undefined : "polygon(0 0, calc(100% - 11px) 0, 100% 100%, 0 100%)",
          padding: "7px 14px 6px 14px",
        }}
      >
        {renaming ? (
          <input
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setRenaming(false);
                setDraft(column.title);
              }
            }}
            className="min-w-0 flex-1 rounded-[2px] border border-[rgba(0,0,0,.25)] bg-[rgba(255,255,255,.55)] px-1.5 py-0.5 font-archivo text-[11px] font-bold uppercase tracking-[.1em] text-manila-ink"
          />
        ) : (
          // Reserves room under the overlay buttons below so the title never
          // truncates behind them — they've been pulled out of this element
          // entirely (see the sibling overlay), not just visually spaced.
          <span
            className={`min-w-0 flex-1 truncate font-archivo text-[11px] font-bold uppercase tracking-[.12em] text-manila-ink${showEditButtons ? " pr-11" : ""}`}
          >
            {pending ? "filing…" : column.title}
            <span className="ml-1.5 tabular-nums opacity-70">{tasks.length}</span>
          </span>
        )}
      </div>

      {/* Rendered as a sibling of the tab, not a descendant — the tab's own
          `clipPath` above clips its *entire* subtree to a polygon bounded by
          its own box (`0 0` to `100% 100%`), which silently ate the 44px
          hit-slop below (DESIGN §7) when these buttons lived inside it: any
          part of the slop extending past the tab's edges was clipped away
          along with the corner notch, confirmed live via
          `document.elementFromPoint` resolving to the page background
          instead of the button a few px above its visible edge. Living
          outside the clip keeps the same screen position (`absolute`,
          anchored to the same padding the tab used) without being subject
          to it. */}
      {showEditButtons && (
        <div className="absolute right-3.5 top-[7px] flex items-center gap-1">
          <button
            type="button"
            aria-label={`Rename ${column.title}`}
            onClick={startRename}
            // The painted glyph stays 20px (12px icon + 4px padding); the
            // transparent `before:` hit-slop below extends the actual
            // clickable box to 44px on every side around it.
            className="relative rounded-[2px] p-1 text-manila-ink opacity-60 transition-opacity duration-hover before:absolute before:inset-[-12px] before:content-[''] hover:opacity-100"
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Delete ${column.title}`}
            onClick={() => setConfirmingDelete(true)}
            className="relative rounded-[2px] p-1 text-manila-ink opacity-60 transition-opacity duration-hover before:absolute before:inset-[-12px] before:content-[''] hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}

      <div
        ref={setNodeRef}
        className="-mt-px flex flex-col gap-[11px] rounded-tray border p-3 shadow-tray transition-colors duration-200"
        style={{
          background: isOver
            ? "linear-gradient(rgba(240,222,186,.4),rgba(240,222,186,.26))"
            : "linear-gradient(rgba(215,192,151,.26),rgba(215,192,151,.16))",
          borderColor: isOver ? "rgba(255,255,255,.42)" : "rgba(255,255,255,.22)",
          minHeight: 218,
          // `dvh`, not `vh`: on mobile Safari/Chrome `vh` is the *largest*
          // viewport, so with the URL bar showing the tray's own scroll
          // container ran past the bottom of the screen and the composer at
          // its foot was unreachable. `max()` keeps a short landscape phone
          // (where `100dvh - 300px` goes near zero) from collapsing the tray
          // to a sliver — below that floor the strip scrolls instead.
          maxHeight: "max(220px, calc(100dvh - 300px))",
          overflowY: "auto",
        }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className="grid h-[78px] place-items-center rounded-[3px] border-[1.5px] border-dashed border-[rgba(255,247,230,.34)]">
              <span className="font-courier text-[12px] text-[rgba(255,247,230,.6)]">
                no cards filed
              </span>
            </div>
          ) : (
            tasks.map((task: Task) => (
              <TaskCard
                key={task.id}
                task={task}
                done={done}
                // A VIEWER's cards must not be draggable. The server is the
                // real gate and correctly 403s the move, but without this
                // the card still lifted, animated to its new slot, and only
                // then snapped back under a "Couldn't move that card"
                // toast — every other control here already checks canEdit
                // (the column's own useSortable, the composer, the edit and
                // delete buttons), so this one was an oversight rather than
                // a decision.
                sortable={canEdit}
                onOpen={canEdit ? () => onEditTask(task) : undefined}
              />
            ))
          )}
        </SortableContext>

        {canEdit && !pending && <TaskComposer columnId={column.id} boardId={boardId} />}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete "${column.title}"?`}
        description="Every card filed in this column goes with it. This can't be undone."
        loading={deleteColumn.isPending}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          deleteColumn.mutate(column.id);
          setConfirmingDelete(false);
        }}
      />
    </div>
  );
}
