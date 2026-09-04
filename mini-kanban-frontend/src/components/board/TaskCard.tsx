"use client";

import type { Task } from "@/lib/types";

/**
 * The index card, `DESIGN §4.4` exact: 29px top padding clearing the label
 * and red rule, the red rule + 21px ruled lines as CSS gradients, hairline,
 * meta row. The **21px title line-height is load-bearing** — it is what the
 * ruled lines underneath line up with; change one and both drift apart.
 *
 * Two slots in §4.4's anatomy assume data this app's `Task` doesn't have —
 * a `kind` taxonomy (for the `filed` label's colour) and a due date +
 * assignee (for the meta row). The committed schema (PLAN §2) carries only
 * `title`/`description`/`rank`/`version`/timestamps, so rather than
 * fabricate a ticket code or an assignee this card never had, both slots are
 * filled from what is real: the `filed` label reads the creation date at
 * `--faint` (§4.4's own default-kind colour, since there is no kind), and
 * the meta row reads "updated …" with no avatar. The `overdue` stamp is
 * skipped for the same reason — there is no due date to be overdue against.
 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relativeUpdate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const ms = Date.now() - then;
  const min = Math.round(ms / 60000);
  if (min < 1) return "updated just now";
  if (min < 60) return `updated ${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `updated ${hr}h ago`;
  return `updated ${shortDate(iso)}`;
}

/** A task is "done" iff its parent column is named Done — there is no status
 *  field on Task itself; done-ness is a property of which column holds it. */
export function TaskCard({
  task,
  done = false,
}: {
  task: Task;
  done?: boolean;
}) {
  return (
    <article
      tabIndex={0}
      className="relative rounded-card border border-card-edge bg-card px-[13px] pb-[11px] pt-[29px] shadow-card"
      style={{
        backgroundImage:
          "linear-gradient(rgba(178,66,52,.5) 0 1px, transparent 1px), repeating-linear-gradient(rgba(47,92,134,.08) 0 1px, transparent 1px 21px)",
        backgroundPosition: "0 22px, 0 24px",
        backgroundRepeat: "no-repeat, repeat",
        opacity: done ? 0.7 : undefined,
      }}
    >
      <span className="absolute left-[13px] top-[5px] font-courier text-[9.5px] font-bold uppercase tracking-[.14em] text-faint">
        filed {shortDate(task.createdAt)}
      </span>

      <h3
        className="font-courier text-[13px] font-bold leading-[21px]"
        style={
          done
            ? { textDecoration: "line-through", color: "rgba(35,31,26,.32)", fontWeight: 400 }
            : { color: "var(--ink)" }
        }
      >
        {task.title}
      </h3>

      {task.description && (
        <p className="mt-0.5 line-clamp-2 font-courier text-[11px] leading-[15px] text-pencil">
          {task.description}
        </p>
      )}

      <div className="mt-2 flex items-center border-t border-hair pt-2">
        <span className="font-courier text-[11px] text-faint">
          {relativeUpdate(task.updatedAt)}
        </span>
      </div>
    </article>
  );
}
