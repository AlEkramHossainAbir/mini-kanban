"use client";

import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

const MAX_TILT_DEG = 6;
const SMOOTHING = 0.35;

/**
 * The lifted card inside `<DragOverlay>` (DESIGN §5/§6): `scale(1.05)` plus
 * a velocity-proportional tilt of up to ±6°, written every frame into a
 * `--tilt` custom property rather than returned from a dnd-kit modifier —
 * a modifier's transform fights dnd-kit's own positioning and drifts the
 * card off the cursor (`DESIGN §6`).
 *
 * Tracks raw `pointermove` events (no `getBoundingClientRect()` — DESIGN
 * §6's render-cost rule) and writes the style directly via a ref, never
 * through React state, so the tilt doesn't re-render anything per frame.
 */
export function DragOverlayCard({ task, done }: { task: Task; done: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lastX: number | null = null;
    let lastT = 0;
    let tilt = 0;
    let raf = 0;

    function onPointerMove(e: PointerEvent) {
      const now = performance.now();
      if (lastX !== null && !reduceMotion) {
        const dt = Math.max(now - lastT, 1);
        const velocity = (e.clientX - lastX) / dt; // px/ms
        const target = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, velocity * 14));
        tilt += (target - tilt) * SMOOTHING;
      }
      lastX = e.clientX;
      lastT = now;
    }

    function loop() {
      ref.current?.style.setProperty("--tilt", `${reduceMotion ? 0 : tilt.toFixed(2)}deg`);
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener("pointermove", onPointerMove);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="w-[280px] cursor-grabbing"
      style={{
        transform: "scale(1.05) rotate(var(--tilt, 0deg))",
        // Only alive for the lifetime of the overlay itself, never on a
        // card sitting still (DESIGN §5 rule 2).
        willChange: "transform",
      }}
    >
      <TaskCard task={task} done={done} sortable={false} lifted />
    </div>
  );
}
