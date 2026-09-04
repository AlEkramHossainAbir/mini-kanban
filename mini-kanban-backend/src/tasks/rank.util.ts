/**
 * LexoRank-style fractional rank strings (PLAN §2). Pure functions, zero
 * I/O — no Prisma, no NestJS, nothing async. Orders both `Task.rank` and
 * `Column.rank`; callers own persistence and re-querying, this file only
 * ever computes strings.
 *
 * Ranks are drawn from a fixed base-36 alphabet (digits then lowercase —
 * deliberately no uppercase, so plain ASCII/byte comparison, which is what
 * `ORDER BY rank` in Postgres does, can never disagree with this module's
 * own digit-by-digit comparisons over collation quirks).
 */

export const RANK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = RANK_ALPHABET.length; // 36

// PLAN §2's "rank exceeds ~40 chars" rebalance trigger, defined once here
// so the service that wires this up (Phase 8) doesn't have to invent it.
export const RANK_LENGTH_REBALANCE_THRESHOLD = 40;

function digitOf(char: string): number {
  const index = RANK_ALPHABET.indexOf(char);
  if (index === -1) {
    throw new Error(`Not a rank character: ${JSON.stringify(char)}`);
  }
  return index;
}

function charOf(digit: number): string {
  return RANK_ALPHABET[digit];
}

/**
 * The keyspace's minimum boundary — sorts before every real rank. Used as
 * the lower bound when inserting before the current first item (PLAN §2:
 * "insert at start: midpoint of "" and the first rank").
 */
export function first(): string {
  return '';
}

/**
 * The keyspace's fixed maximum sentinel — never itself assigned as a real
 * rank, only ever used as an upper bound (PLAN §2: "insert at end: midpoint
 * of the last rank and a fixed max sentinel"). `between()` always returns a
 * value strictly less than this, so it can never collide with a real rank.
 */
export function last(): string {
  return RANK_ALPHABET[BASE - 1];
}

/**
 * The lexicographic midpoint of `a` and `b` — the one rank-computation
 * primitive everything else in this module (and the move endpoints, Phase
 * 8) is built from. Requires `a < b`; throws otherwise, since there is no
 * valid answer when that doesn't hold.
 *
 * Treats each string as a base-36 fraction: a missing character in `a`
 * (the shorter side) is an implicit `0` digit; a missing character in `b`
 * is an implicit "one past the highest digit" (unconstrained). Where the
 * two digit sequences are still equal, the shared prefix is kept and the
 * walk continues one position deeper; where they're more than one digit
 * apart, the midpoint digit is returned immediately; where they're exactly
 * one digit apart (the "adjacent" case — no integer sits between them at
 * this position), `a`'s digit is kept and the walk continues using `a`'s
 * own remaining digits against an now-unconstrained upper bound, growing
 * the result by one character at a time until room opens up.
 */
export function between(a: string, b: string): string {
  if (a >= b) {
    throw new Error(
      `between(a, b) requires a < b, got ${JSON.stringify(a)} >= ${JSON.stringify(b)}`,
    );
  }

  let prefix = '';
  let i = 0;
  let upper = b;
  for (;;) {
    const digitA = i < a.length ? digitOf(a[i]) : 0;
    const digitB = i < upper.length ? digitOf(upper[i]) : BASE;

    if (digitA === digitB) {
      prefix += charOf(digitA);
      i++;
      continue;
    }

    if (digitB - digitA > 1) {
      const mid = Math.floor((digitA + digitB) / 2);
      return prefix + charOf(mid);
    }

    // Adjacent digits (digitB === digitA + 1): no room here. Commit to a's
    // digit and keep going, now unconstrained above (upper's contribution
    // is exhausted from this position on).
    prefix += charOf(digitA);
    i++;
    upper = '';
  }
}

/**
 * Re-spaces `ranks.length` items evenly across the full keyspace, keeping
 * their relative order (`result[i]` replaces `ranks[i]`) — the values in
 * `ranks` themselves are never read, only the count and order matter. Used
 * when repeated insertions at the same boundary have made a rank string
 * grow past `RANK_LENGTH_REBALANCE_THRESHOLD` (PLAN §2).
 *
 * Implemented as balanced binary space partitioning over `between()`
 * itself — the middle element of a sub-range gets the midpoint of that
 * sub-range's bounds, then each half recurses into its own half-open
 * interval. Every generated value is therefore, by construction (not by
 * separate proof), strictly between `first()` and `last()` and strictly
 * ordered — it can't drift outside the keyspace the way a hand-rolled
 * fixed-width digit encoding could near the boundaries.
 */
export function rebalance(ranks: readonly string[]): string[] {
  const result = new Array<string>(ranks.length);
  fillRange(0, ranks.length - 1, first(), last(), result);
  return result;
}

function fillRange(
  lo: number,
  hi: number,
  lowerBound: string,
  upperBound: string,
  out: string[],
): void {
  if (lo > hi) {
    return;
  }
  const mid = Math.floor((lo + hi) / 2);
  const midRank = between(lowerBound, upperBound);
  out[mid] = midRank;
  fillRange(lo, mid - 1, lowerBound, midRank, out);
  fillRange(mid + 1, hi, midRank, upperBound, out);
}
