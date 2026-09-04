"use client";

import { useEffect, useState } from "react";

/**
 * DESIGN §5's "conflict flash" (760ms, one-shot `box-shadow`, on `--ease` —
 * explicitly *not* a transition, since rule 1 bans transitioning
 * `box-shadow` continuously). Frontend ROADMAP Phase 11's own "Done when"
 * spells it out: "a 409 rolls the card back with the flash and the error
 * toast" — `useMoveTask`'s `onError` (`src/lib/tasks.ts`) already does the
 * rollback and the toast; this is the missing third piece.
 *
 * A tiny module-level pub/sub, not React Query state: the flash is a
 * one-shot animation cue for one specific `TaskCard` instance, not board
 * data anything else needs to read, and it has to reach a component several
 * layers below the mutation's `onError` without every card in between
 * re-rendering on account of it.
 */
const listeners = new Map<string, Set<() => void>>();

export function fireConflictFlash(taskId: string): void {
  listeners.get(taskId)?.forEach((fn) => fn());
}

export function useConflictFlash(taskId: string): boolean {
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      setFlashing(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setFlashing(false), 760);
    };

    let set = listeners.get(taskId);
    if (!set) {
      set = new Set();
      listeners.set(taskId, set);
    }
    set.add(handler);

    return () => {
      clearTimeout(timeout);
      set?.delete(handler);
      if (set?.size === 0) listeners.delete(taskId);
    };
  }, [taskId]);

  return flashing;
}
