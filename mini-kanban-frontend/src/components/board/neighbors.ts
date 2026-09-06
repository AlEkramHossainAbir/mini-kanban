/**
 * The pure half of the drop→payload computation in `useBoardDnd`.
 *
 * PLAN §3's move endpoints are addressed by *neighbour ids*, not indices:
 * a drop says "put me between these two cards" and the server derives the
 * rank. Deriving that pair from an ordered id list is the one piece of the
 * graded drag path that is plain data-in/data-out — no dnd-kit event, no
 * React state, no network — so it lives here on its own and is unit-tested
 * directly (`neighbors.test.ts`), the same way the backend's `rank.util.ts`
 * is tested apart from the service that wires it up.
 *
 * The hook computes this in four places (task pickup, task drop, column
 * pickup, column drop) and compares pickup against drop to decide whether a
 * drag actually changed anything. Both operations are here.
 */

/** A task's or column's immediate siblings in render order. `null` on either
 *  side means "no neighbour" — i.e. it sits at that end of the list, which is
 *  exactly what the move API reads as the first/last position. */
export interface Neighbors {
  before: string | null;
  after: string | null;
}

/**
 * The ids either side of `id` in `ids`.
 *
 * An `id` that isn't in the list yields `{ before: null, after: null }` —
 * the same pair as a lone item in a one-element list. That is deliberate and
 * safe: both mean "no bounds", which the server resolves to the sentinel
 * bounds and appends (`resolveNeighborBounds`, PLAN §3's self-healing rule),
 * so a stale id degrades to an append rather than throwing mid-drag.
 */
export function neighborsOf(ids: readonly string[], id: string): Neighbors {
  const index = ids.indexOf(id);
  if (index < 0) {
    return { before: null, after: null };
  }
  return {
    before: index > 0 ? ids[index - 1] : null,
    after: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

/**
 * Whether a drop landed back where it started, so the drag can be discarded
 * without a network call. Compared on neighbour ids rather than index
 * because an index can shift under a concurrent remote edit while the card's
 * actual position — who it sits between — has not changed.
 */
export function sameNeighbors(a: Neighbors, b: Neighbors): boolean {
  return a.before === b.before && a.after === b.after;
}
