import { describe, expect, it } from "vitest";
import {
  moveTaskOptimistic,
  removeTaskFromBoard,
  upsertOrInsertTask,
  upsertTaskInBoard,
  type MoveTaskResult,
} from "./tasks";
import type { Board, Task } from "./types";

/**
 * The TanStack Query cache transforms behind PLAN §6's optimistic move.
 * Every one of these runs on the board a user is looking at, so a mistake
 * here shows up as a duplicated, vanished or reverted card rather than an
 * error — worth asserting directly.
 */

function task(id: string, columnId: string, rank: string, over: Partial<Task> = {}): Task {
  return {
    id,
    columnId,
    boardId: "board-1",
    title: `Task ${id}`,
    description: null,
    rank,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function board(): Board {
  return {
    id: "board-1",
    title: "Board",
    description: null,
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    columns: [
      {
        id: "todo",
        boardId: "board-1",
        title: "To Do",
        rank: "d",
        tasks: [task("t1", "todo", "d"), task("t2", "todo", "h")],
      },
      {
        id: "done",
        boardId: "board-1",
        title: "Done",
        rank: "h",
        tasks: [task("t3", "done", "d")],
      },
    ],
  };
}

/** Every task in the board, flattened — used to assert nothing was lost. */
function allIds(b: Board): string[] {
  return (b.columns ?? []).flatMap((c) => c.tasks.map((t) => t.id)).sort();
}

function columnIds(b: Board, columnId: string): string[] {
  return (b.columns ?? []).find((c) => c.id === columnId)!.tasks.map((t) => t.id);
}

describe("upsertTaskInBoard", () => {
  const patch: MoveTaskResult = {
    id: "t1",
    columnId: "done",
    rank: "n",
    version: 2,
    updatedAt: "2026-09-02T00:00:00.000Z",
  };

  it("relocates a task to its new column exactly once", () => {
    const next = upsertTaskInBoard(board(), patch);
    expect(columnIds(next, "todo")).toEqual(["t2"]);
    expect(columnIds(next, "done")).toEqual(["t3", "t1"]);
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("preserves fields the move response does not carry", () => {
    // The move endpoint returns a minimal shape (PLAN §3's MOVE_RESULT_SELECT),
    // so this must merge onto the cached row, never replace it — otherwise
    // every drag wipes the card's title and description.
    const withText = board();
    withText.columns![0].tasks[0] = task("t1", "todo", "d", {
      title: "Keep me",
      description: "And me",
    });
    const moved = upsertTaskInBoard(withText, patch);
    const found = moved.columns!.find((c) => c.id === "done")!.tasks.find((t) => t.id === "t1")!;
    expect(found.title).toBe("Keep me");
    expect(found.description).toBe("And me");
    expect(found.rank).toBe("n");
    expect(found.version).toBe(2);
  });

  it("updates in place for a same-column reorder", () => {
    const next = upsertTaskInBoard(board(), { ...patch, columnId: "todo" });
    expect(columnIds(next, "todo")).toEqual(["t1", "t2"]);
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("ignores a patch for a task the cache has never seen", () => {
    const next = upsertTaskInBoard(board(), { ...patch, id: "ghost" });
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not mutate the board it was given", () => {
    const original = board();
    upsertTaskInBoard(original, patch);
    expect(columnIds(original, "todo")).toEqual(["t1", "t2"]);
  });
});

describe("moveTaskOptimistic", () => {
  it("moves the task and bumps its version for the round trip", () => {
    const next = moveTaskOptimistic(board(), "t1", {
      targetColumnId: "done",
      beforeTaskId: "t3",
      afterTaskId: null,
      expectedVersion: 1,
    });
    const moved = next.columns!.find((c) => c.id === "done")!.tasks.find((t) => t.id === "t1")!;
    expect(moved.columnId).toBe("done");
    // The optimistic row must lead the server by one, so a WebSocket echo of
    // this same move is recognised as "already applied" rather than reapplied.
    expect(moved.version).toBe(2);
  });

  it("estimates a rank that sorts after the card it was dropped below", () => {
    const next = moveTaskOptimistic(board(), "t1", {
      targetColumnId: "done",
      beforeTaskId: "t3",
      afterTaskId: null,
      expectedVersion: 1,
    });
    const done = next.columns!.find((c) => c.id === "done")!;
    const t1 = done.tasks.find((t) => t.id === "t1")!;
    const t3 = done.tasks.find((t) => t.id === "t3")!;
    expect(t1.rank > t3.rank).toBe(true);
  });

  it("estimates a rank that sorts before the card it was dropped above", () => {
    const next = moveTaskOptimistic(board(), "t2", {
      targetColumnId: "done",
      beforeTaskId: null,
      afterTaskId: "t3",
      expectedVersion: 1,
    });
    const done = next.columns!.find((c) => c.id === "done")!;
    const t2 = done.tasks.find((t) => t.id === "t2")!;
    const t3 = done.tasks.find((t) => t.id === "t3")!;
    expect(t2.rank < t3.rank).toBe(true);
  });

  it("leaves the board untouched for an unknown task id", () => {
    const next = moveTaskOptimistic(board(), "ghost", {
      targetColumnId: "done",
      expectedVersion: 1,
    });
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("falls back to the task's own rank rather than throwing on bad bounds", () => {
    // `beforeTaskId` naming a card that sorts *after* `afterTaskId` is an
    // impossible pair; the estimate is cosmetic, so it must degrade quietly.
    const next = moveTaskOptimistic(board(), "t3", {
      targetColumnId: "todo",
      beforeTaskId: "t2",
      afterTaskId: "t1",
      expectedVersion: 1,
    });
    const moved = next.columns!.find((c) => c.id === "todo")!.tasks.find((t) => t.id === "t3")!;
    expect(moved.rank).toBe("d");
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("upsertOrInsertTask", () => {
  it("inserts a task the cache has never seen (another user's create)", () => {
    const incoming = task("t9", "done", "n");
    const next = upsertOrInsertTask(board(), incoming);
    expect(columnIds(next, "done")).toEqual(["t3", "t9"]);
  });

  it("relocates rather than duplicates a task it already holds", () => {
    const incoming = task("t1", "done", "n", { version: 3 });
    const next = upsertOrInsertTask(board(), incoming);
    expect(columnIds(next, "todo")).toEqual(["t2"]);
    expect(columnIds(next, "done")).toEqual(["t3", "t1"]);
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("drops a task whose column is not in the cache", () => {
    // Nothing to attach it to — better absent than filed under the wrong tab.
    const next = upsertOrInsertTask(board(), task("t9", "archive", "n"));
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("removeTaskFromBoard", () => {
  it("removes the task from whichever column holds it", () => {
    const next = removeTaskFromBoard(board(), "t2");
    expect(columnIds(next, "todo")).toEqual(["t1"]);
    expect(allIds(next)).toEqual(["t1", "t3"]);
  });

  it("is a no-op for an id that is already gone", () => {
    const next = removeTaskFromBoard(board(), "ghost");
    expect(allIds(next)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not mutate the board it was given", () => {
    const original = board();
    removeTaskFromBoard(original, "t2");
    expect(allIds(original)).toEqual(["t1", "t2", "t3"]);
  });
});
