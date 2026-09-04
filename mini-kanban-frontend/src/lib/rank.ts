/**
 * The one sort in the app (PLAN §6, frontend ROADMAP Phase 6): rendered order
 * is always the `rank` string, `id` as a tiebreak, and nothing else. No
 * separate client-side reordering logic exists that could disagree with the
 * server's rank — that disagreement is the usual root cause of "drag one
 * card, unrelated cards reshuffle."
 *
 * The API already returns columns/tasks pre-sorted this way
 * (`ORDER BY rank, id` — boards.service.ts `findOne`), so this is a defensive
 * re-sort: it protects the render from an optimistic cache write (Phase 8)
 * or a WebSocket patch (Phase 10) that lands out of order, without either of
 * those call sites needing to know how to sort.
 */
export function sortByRank<T extends { rank: string; id: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
