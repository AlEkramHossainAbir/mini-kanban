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

/**
 * The read half of the backend's LexoRank scheme (`mini-kanban-backend/src/
 * tasks/rank.util.ts`), ported here **only** to estimate a plausible rank for
 * an optimistic cache write (frontend ROADMAP Phase 8). The server remains
 * the single source of truth for the real value — `useMoveTask`'s `onSuccess`
 * always overwrites this guess with the response's authoritative `rank`. No
 * `rebalance()` here: that is a write-time server concern this client never
 * performs.
 */
const RANK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = RANK_ALPHABET.length;

export function first(): string {
  return "";
}

export function last(): string {
  return RANK_ALPHABET[BASE - 1];
}

/** Lexicographic midpoint of `a` and `b`. Requires `a < b`. */
export function between(a: string, b: string): string {
  if (a >= b) {
    throw new Error(`between(a, b) requires a < b, got ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
  }

  let prefix = "";
  let i = 0;
  let upper = b;
  for (;;) {
    const digitA = i < a.length ? RANK_ALPHABET.indexOf(a[i]) : 0;
    const digitB = i < upper.length ? RANK_ALPHABET.indexOf(upper[i]) : BASE;

    if (digitA === digitB) {
      prefix += RANK_ALPHABET[digitA];
      i++;
      continue;
    }

    if (digitB - digitA > 1) {
      return prefix + RANK_ALPHABET[Math.floor((digitA + digitB) / 2)];
    }

    prefix += RANK_ALPHABET[digitA];
    i++;
    upper = "";
  }
}
