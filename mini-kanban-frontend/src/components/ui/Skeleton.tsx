"use client";

import { cn } from "@/lib/cn";

/**
 * DESIGN §4.7 — card-shaped: --card-2 fill, the same 3px radius and the ruled
 * background, animate-pulse (1.6s per §5's motion table).
 * Never a spinner on the board.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-card bg-card-2 [animation-duration:1.6s]",
        className
      )}
    />
  );
}

/** A skeleton that carries the index card's ruling, so loading state reads as
 *  the same object as the thing it becomes (§4.7). The 21px line spacing is
 *  load-bearing — it matches the card line-height in §3/§4.4. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-[86px] animate-pulse rounded-card border border-card-edge bg-card-2 [animation-duration:1.6s]",
        className
      )}
      style={{
        backgroundImage:
          "linear-gradient(var(--hair) 1px, transparent 1px)",
        backgroundSize: "100% 21px",
        backgroundPosition: "0 29px",
      }}
    />
  );
}
