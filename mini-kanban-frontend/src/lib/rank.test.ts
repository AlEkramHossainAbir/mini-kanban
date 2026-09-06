import { describe, expect, it } from "vitest";
import { between, first, last, sortByRank } from "./rank";

/**
 * `rank.ts` is the read half of the backend's LexoRank scheme, ported for
 * optimistic cache writes (frontend ROADMAP Phase 8). It has to agree with
 * `mini-kanban-backend/src/tasks/rank.util.ts` on ordering, because a client
 * estimate that sorts differently from the server's real rank is exactly the
 * "drag one card, unrelated cards reshuffle" bug PLAN §6 is written to avoid.
 */
describe("sortByRank", () => {
  it("orders by rank string, not insertion order", () => {
    const items = [
      { id: "c", rank: "n" },
      { id: "a", rank: "d" },
      { id: "b", rank: "h" },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a rank tie on id, deterministically", () => {
    // Colliding ranks are rare but legal by design (PLAN §3) — what matters
    // is that the order never flaps between two renders of the same data.
    const items = [
      { id: "zz", rank: "h" },
      { id: "aa", rank: "h" },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(["aa", "zz"]);
    expect(sortByRank(items.slice().reverse()).map((i) => i.id)).toEqual(["aa", "zz"]);
  });

  it("does not mutate its input", () => {
    const items = [
      { id: "b", rank: "n" },
      { id: "a", rank: "d" },
    ];
    const snapshot = [...items];
    sortByRank(items);
    expect(items).toEqual(snapshot);
  });

  it("sorts ranks of differing length as a fraction, not by length", () => {
    // "h" < "h5" < "i": a longer string is not automatically later.
    const items = [
      { id: "later", rank: "i" },
      { id: "middle", rank: "h5" },
      { id: "early", rank: "h" },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(["early", "middle", "later"]);
  });
});

describe("between", () => {
  it("returns a value strictly inside the bounds", () => {
    const mid = between("a", "c");
    expect(mid > "a").toBe(true);
    expect(mid < "c").toBe(true);
  });

  it("keeps subdividing when the bounds are adjacent characters", () => {
    // No integer gap between "a" and "b" — the midpoint has to grow a
    // character rather than fail.
    const mid = between("a", "b");
    expect(mid > "a").toBe(true);
    expect(mid < "b").toBe(true);
    expect(mid.length).toBeGreaterThan(1);
  });

  it("inserts before the first item using the empty-string lower bound", () => {
    const mid = between(first(), "h");
    expect(mid > first()).toBe(true);
    expect(mid < "h").toBe(true);
  });

  it("inserts after the last item, below the max sentinel", () => {
    const mid = between("h", last());
    expect(mid > "h").toBe(true);
    // The sentinel is a bound, never itself a rank — so a real rank must
    // stay strictly under it or ordering breaks at the end of a column.
    expect(mid < last()).toBe(true);
  });

  it("stays ordered across repeated inserts at the same boundary", () => {
    // The pathological case: always dropping at the very top. Each new rank
    // must still sort before the previous one.
    let upper = "h";
    const ranks: string[] = [];
    for (let i = 0; i < 50; i++) {
      upper = between(first(), upper);
      ranks.push(upper);
    }
    const ascending = [...ranks].reverse();
    expect([...ascending].sort()).toEqual(ascending);
  });

  it("throws when the bounds are equal or inverted", () => {
    expect(() => between("h", "h")).toThrow();
    expect(() => between("n", "d")).toThrow();
  });
});
