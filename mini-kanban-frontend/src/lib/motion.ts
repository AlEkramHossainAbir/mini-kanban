"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * DESIGN §5 rule 3 — `prefers-reduced-motion: reduce` must kill tilt/scale/
 * overshoot and collapse reflow + drop to ≤1ms. `globals.css`'s blanket
 * `transition-duration` override (frontend ROADMAP Phase 3) only reaches
 * plain CSS transitions; dnd-kit drives its own reflow/drop animations
 * through the Web Animations API (`element.animate()`), which that override
 * never touches. This hook is what the drag path (frontend ROADMAP Phase 11)
 * checks instead, alongside `DragOverlayCard`'s own `matchMedia` read for the
 * velocity tilt.
 *
 * Reactive (not a one-shot read) so a setting flipped mid-session — a real
 * a11y testing pattern — takes effect without a reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * DESIGN §5's reflow row: 280ms on `--ease` (`cubic-bezier(.22,.85,.28,1)`),
 * fed to `useSortable({ transition })` on both `TaskCard` and `BoardColumn`'s
 * tab — dnd-kit's own default (200ms `ease`) is not this direction's
 * signature and, like every other `DndContext` setting in DESIGN §6, has to
 * be set explicitly rather than left at the library default.
 */
export function sortableTransition(reduced: boolean): { duration: number; easing: string } {
  return reduced
    ? { duration: 1, easing: "linear" }
    : { duration: 280, easing: "cubic-bezier(.22,.85,.28,1)" };
}
