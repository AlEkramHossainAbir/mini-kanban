"use client";

import { Skeleton } from "@/components/ui";

/** Shaped like real columns/cards (`DESIGN §4.7`) — never a spinner on the
 *  board. Three columns of three cards is enough to read as "a board",
 *  without pretending to know the real column count before it loads. */
export function BoardSkeleton() {
  return (
    <div className="flex gap-[14px] overflow-x-auto px-[var(--gutter)] pb-8 pt-6">
      {[0, 1, 2].map((c) => (
        <div key={c} className="flex w-[var(--col-w)] flex-shrink-0 flex-col" aria-hidden>
          <Skeleton className="h-[26px] w-[120px] rounded-tab" />
          <div
            className="-mt-px flex flex-col gap-[11px] rounded-tray border border-[rgba(255,255,255,.18)] p-3"
            style={{
              background: "linear-gradient(rgba(215,192,151,.16),rgba(215,192,151,.1))",
              minHeight: 218,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[86px] animate-pulse rounded-card border border-card-edge bg-card-2 [animation-duration:1.6s]"
                style={{
                  backgroundImage: "linear-gradient(var(--hair) 1px, transparent 1px)",
                  backgroundSize: "100% 21px",
                  backgroundPosition: "0 29px",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
