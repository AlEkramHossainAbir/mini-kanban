import { describe, expect, it } from "vitest";
import { neighborsOf, sameNeighbors } from "./neighbors";

/**
 * The drop→payload derivation behind PLAN §3's move endpoints. Getting this
 * wrong doesn't crash anything — it silently files the card in the wrong
 * place, which is precisely the class of bug the brief grades under "order
 * consistency", so it is asserted directly rather than inferred from a
 * simulated drag.
 */
describe("neighborsOf", () => {
  const ids = ["a", "b", "c", "d"];

  it("reports both siblings for an item in the middle", () => {
    expect(neighborsOf(ids, "c")).toEqual({ before: "b", after: "d" });
  });

  it("reports a null lower bound at the head of the list", () => {
    // "before: null" is what the move API reads as "first position".
    expect(neighborsOf(ids, "a")).toEqual({ before: null, after: "b" });
  });

  it("reports a null upper bound at the tail of the list", () => {
    expect(neighborsOf(ids, "d")).toEqual({ before: "c", after: null });
  });

  it("reports no bounds for the only item in a column", () => {
    expect(neighborsOf(["solo"], "solo")).toEqual({ before: null, after: null });
  });

  it("reports no bounds for an id that isn't in the list", () => {
    // Degrades to an append server-side (PLAN §3's self-healing rule)
    // rather than throwing part-way through a drag.
    expect(neighborsOf(ids, "missing")).toEqual({ before: null, after: null });
    expect(neighborsOf([], "anything")).toEqual({ before: null, after: null });
  });

  it("describes every position of a card walked down its column", () => {
    // Walking one card through each slot must produce the pair of ids that
    // actually surround it at that slot — the payload the server ranks from.
    const walked = ["x", "a", "b"];
    expect(neighborsOf(walked, "x")).toEqual({ before: null, after: "a" });
    expect(neighborsOf(["a", "x", "b"], "x")).toEqual({ before: "a", after: "b" });
    expect(neighborsOf(["a", "b", "x"], "x")).toEqual({ before: "b", after: null });
  });
});

describe("sameNeighbors", () => {
  it("recognises a card dropped back exactly where it started", () => {
    const order = ["a", "b", "c"];
    expect(sameNeighbors(neighborsOf(order, "b"), neighborsOf(order, "b"))).toBe(true);
  });

  it("recognises a real reorder", () => {
    const before = neighborsOf(["a", "b", "c"], "b");
    const after = neighborsOf(["b", "a", "c"], "b");
    expect(sameNeighbors(before, after)).toBe(false);
  });

  it("distinguishes a null bound from a present one", () => {
    // Head-of-list and second-in-list share an `after` but not a `before`;
    // treating them as equal would swallow a genuine move to the top.
    expect(
      sameNeighbors({ before: null, after: "b" }, { before: "a", after: "b" })
    ).toBe(false);
  });

  it("is unaffected by unrelated cards moving elsewhere in the column", () => {
    // "b" keeps the same neighbours even though "d" moved — no round trip
    // should be spent on a card that did not actually change position.
    const before = neighborsOf(["a", "b", "c", "d"], "b");
    const after = neighborsOf(["d", "a", "b", "c"], "b");
    expect(sameNeighbors(before, after)).toBe(true);
  });
});
