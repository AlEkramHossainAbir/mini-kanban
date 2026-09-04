"use client";

import type { Column } from "@/lib/types";
import { gradientFor } from "./BoardColumn";

/**
 * The lifted copy of a column tab inside `<DragOverlay>` (frontend ROADMAP
 * Phase 9) — the column-drag twin of `DragOverlayCard`. Deliberately just
 * the tab, not the whole tray: the tray's cards are still visible, in flow,
 * at the source position while the column itself is being reordered.
 */
export function ColumnDragOverlay({ column }: { column: Column }) {
  const [from, to] = gradientFor(column.title);

  return (
    <div
      className="w-[280px] cursor-grabbing rounded-tab shadow-lift"
      style={{
        background: `linear-gradient(${from},${to})`,
        clipPath: "polygon(0 0, calc(100% - 11px) 0, 100% 100%, 0 100%)",
        padding: "7px 20px 6px 14px",
        transform: "scale(1.03)",
      }}
    >
      <span className="font-archivo text-[11px] font-bold uppercase tracking-[.12em] text-manila-ink">
        {column.title}
        <span className="ml-1.5 tabular-nums opacity-70">{column.tasks.length}</span>
      </span>
    </div>
  );
}
