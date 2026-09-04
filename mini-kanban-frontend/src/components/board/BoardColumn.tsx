"use client";

import { sortByRank } from "@/lib/rank";
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
 * (`DESIGN §4.3`). Read-only for Phase 6 — no add/rename/delete/drag here,
 * those are Phase 7 (drag) and Phase 9 (column CRUD).
 *
 * The tray gets its own vertical scroll, capped independently of the
 * board's horizontal strip (`PLAN §6` / `DESIGN §4.1) — the two must never
 * share a scroll container, or a mobile swipe to see more columns fights a
 * vertical swipe to see more cards in one.
 */
export function BoardColumn({ column }: { column: Column }) {
  const [from, to] = gradientFor(column.title);
  const tasks = sortByRank(column.tasks);
  const done = isDoneColumn(column.title);

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
        className="-mt-px flex flex-col gap-[11px] rounded-tray border border-[rgba(255,255,255,.22)] p-3 shadow-tray"
        style={{
          background:
            "linear-gradient(rgba(215,192,151,.26),rgba(215,192,151,.16))",
          minHeight: 218,
          maxHeight: "calc(100vh - 300px)",
          overflowY: "auto",
        }}
      >
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
      </div>
    </div>
  );
}
