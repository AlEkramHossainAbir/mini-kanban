"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Column, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

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

function gradientFor(title: string): [string, string] {
  return TAB_GRADIENT[title.trim().toLowerCase()] ?? DEFAULT_GRADIENT;
}

function isDoneColumn(title: string): boolean {
  return title.trim().toLowerCase() === "done";
}

/**
 * A column: the angle-cut manila tab (`DESIGN §4.2`) over the tray
 * (`DESIGN §4.3`). Drag lands here in Phase 7; add/rename/delete are still
 * Phase 9 (column CRUD).
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
export function BoardColumn({ column, tasks }: { column: Column; tasks: Task[] }) {
  const [from, to] = gradientFor(column.title);
  const done = isDoneColumn(column.title);
  const taskIds = tasks.map((t) => t.id);

  // The whole tray is the droppable, including when it holds zero cards
  // (DESIGN §4.3) — the single most common dnd-kit Kanban bug is an empty
  // column having nothing to hit.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col">
      <div
        className="w-fit self-start rounded-tab shadow-[0_-1px_0_rgba(255,255,255,.4)_inset]"
        style={{
          background: `linear-gradient(${from},${to})`,
          clipPath: "polygon(0 0, calc(100% - 11px) 0, 100% 100%, 0 100%)",
          padding: "7px 20px 6px 14px",
        }}
      >
        <span className="font-archivo text-[11px] font-bold uppercase tracking-[.12em] text-manila-ink">
          {column.title}
          <span className="ml-1.5 tabular-nums opacity-70">{tasks.length}</span>
        </span>
      </div>

      <div
        ref={setNodeRef}
        className="-mt-px flex flex-col gap-[11px] rounded-tray border p-3 shadow-tray transition-colors duration-200"
        style={{
          background: isOver
            ? "linear-gradient(rgba(240,222,186,.4),rgba(240,222,186,.26))"
            : "linear-gradient(rgba(215,192,151,.26),rgba(215,192,151,.16))",
          borderColor: isOver ? "rgba(255,255,255,.42)" : "rgba(255,255,255,.22)",
          minHeight: 218,
          maxHeight: "calc(100vh - 300px)",
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
              <TaskCard key={task.id} task={task} done={done} />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
