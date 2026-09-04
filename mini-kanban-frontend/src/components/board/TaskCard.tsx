"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";
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

/**
 * A task is "done" iff its parent column is named Done — there is no status
 * field on Task itself; done-ness is a property of which column holds it.
 *
 * `sortable` opts into `useSortable` (frontend ROADMAP Phase 7) — the
 * `DragOverlay`'s copy (`DragOverlayCard`) renders a plain `TaskCard` with
 * `sortable={false} lifted`, since the lifted card is a static snapshot,
 * not itself a drop target. The card is its own drag handle — no separate
 * grip affordance (`DESIGN §7`) — so `listeners` spread onto the same
 * element that already carries the click/keyboard affordance.
 *
 * `isDragging`/`lifted` both drive a second, absolutely-positioned shadow
 * layer whose *opacity* changes, rather than transitioning the card's own
 * `box-shadow` (DESIGN §5 rule 1 — box-shadow is never an animated
 * property here). The same layer is what Phase 11 wires a hover state
 * into; only the drag/lifted trigger is built now.
 */
function TaskCardImpl({
  task,
  done = false,
  sortable = true,
  lifted = false,
}: {
  task: Task;
  done?: boolean;
  sortable?: boolean;
  /** True only for the static copy inside `<DragOverlay>` — always "lifted",
   *  since it exists only while a drag is in flight. */
  lifted?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !sortable });

  return (
    <article
      ref={sortable ? setNodeRef : undefined}
      {...(sortable ? attributes : { tabIndex: 0 })}
      {...(sortable ? listeners : {})}
      className="relative rounded-card border border-card-edge bg-card px-[13px] pb-[11px] pt-[29px] shadow-card"
      style={{
        backgroundImage:
          "linear-gradient(rgba(178,66,52,.5) 0 1px, transparent 1px), repeating-linear-gradient(rgba(47,92,134,.08) 0 1px, transparent 1px 21px)",
        backgroundPosition: "0 22px, 0 24px",
        backgroundRepeat: "no-repeat, repeat",
        // The dragged card's source position stays in flow as the drop
        // placeholder, at reduced opacity (DESIGN §6) — the lifted copy
        // itself renders separately, in `DragOverlayCard`.
        opacity: isDragging ? 0.4 : done ? 0.7 : undefined,
        transform: sortable ? CSS.Transform.toString(transform) : undefined,
        transition: sortable ? transition : undefined,
        // Only alive while this exact card is being dragged (DESIGN §5
        // rule 2) — never left on every card, which would cost one
        // compositor layer each.
        willChange: isDragging ? "transform" : undefined,
        touchAction: sortable ? "none" : undefined,
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-card shadow-lift transition-opacity duration-200"
        style={{ opacity: isDragging || lifted ? 1 : 0 }}
      />
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

/** `React.memo`'d on the fields that actually change what's rendered
 *  (`DESIGN §6`'s render-cost rule) — so a drag elsewhere on the board,
 *  which re-renders `BoardColumn`'s task list, doesn't re-render every
 *  card in it. */
export const TaskCard = memo(TaskCardImpl, (prev, next) => {
  return (
    prev.done === next.done &&
    prev.sortable === next.sortable &&
    prev.lifted === next.lifted &&
    prev.task.id === next.task.id &&
    prev.task.rank === next.task.rank &&
    prev.task.version === next.task.version &&
    prev.task.title === next.task.title &&
    prev.task.description === next.task.description &&
    prev.task.updatedAt === next.task.updatedAt
  );
});
