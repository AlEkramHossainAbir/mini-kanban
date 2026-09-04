import { randomUUID } from 'crypto';
import { createE2eContext, E2eContext, E2eUser } from './e2e-harness';

interface TaskView {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  version: number;
}

/**
 * Backend ROADMAP Phase 11 / PLAN §3 — the graded core. Covers the two
 * contracts the endpoint is judged on: a stale `expectedVersion` is refused
 * with `409` and the corrected row, and a `targetColumnId` on another board
 * is refused with `400 INVALID_TARGET_COLUMN`. Ordering is asserted by
 * reading the board back, never by trusting the write's own response.
 */
describe('Task move (e2e)', () => {
  let ctx: E2eContext;
  let user: E2eUser;
  let boardId: string;
  let todoId: string;
  let doingId: string;

  const createTask = async (columnId: string, title: string) => {
    const res = await user.agent
      .post(`/api/v1/columns/${columnId}/tasks`)
      .send({ title })
      .expect(201);
    return res.body as TaskView;
  };

  /** Titles in stored order, which is `rank` asc with `id` as tiebreak. */
  const titlesIn = async (columnId: string): Promise<string[]> => {
    const board = await user.agent.get(`/api/v1/boards/${boardId}`).expect(200);
    const column = board.body.columns.find(
      (c: { id: string }) => c.id === columnId,
    );
    return column.tasks.map((t: TaskView) => t.title);
  };

  const readTask = async (taskId: string): Promise<TaskView> => {
    const board = await user.agent.get(`/api/v1/boards/${boardId}`).expect(200);
    for (const column of board.body.columns) {
      const hit = column.tasks.find((t: TaskView) => t.id === taskId);
      if (hit) return hit;
    }
    throw new Error(`task ${taskId} not found on board`);
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    user = await ctx.signUp();

    const board = await user.agent
      .post('/api/v1/boards')
      .send({ title: 'Move board' })
      .expect(201);
    boardId = board.body.id;

    todoId = (
      await user.agent
        .post(`/api/v1/boards/${boardId}/columns`)
        .send({ title: 'Todo' })
        .expect(201)
    ).body.id;
    doingId = (
      await user.agent
        .post(`/api/v1/boards/${boardId}/columns`)
        .send({ title: 'Doing' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Neighbour-id semantics, straight from resolveNeighborBounds: the moved
  // card lands *after* `beforeTaskId` and *before* `afterTaskId` — they name
  // the two cards it is dropped between, not the destination slot.
  describe('same-column reorder', () => {
    let scratchId: string;

    beforeEach(async () => {
      // A fresh column per test, so ordering assertions are exact rather
      // than relative to whatever earlier tests left behind.
      scratchId = (
        await user.agent
          .post(`/api/v1/boards/${boardId}/columns`)
          .send({ title: `Scratch ${randomUUID().slice(0, 6)}` })
          .expect(201)
      ).body.id;
    });

    it('moves the last card to the top via afterTaskId', async () => {
      const a = await createTask(scratchId, 'A');
      const b = await createTask(scratchId, 'B');
      const c = await createTask(scratchId, 'C');
      expect(await titlesIn(scratchId)).toEqual(['A', 'B', 'C']);

      await user.agent
        .patch(`/api/v1/tasks/${c.id}/move`)
        .send({
          targetColumnId: scratchId,
          afterTaskId: a.id,
          expectedVersion: c.version,
        })
        .expect(200);

      expect(await titlesIn(scratchId)).toEqual(['C', 'A', 'B']);
      // Only the moved row is rewritten — neighbours keep their ranks, which
      // is the whole point of rank strings over integer positions (PLAN §3).
      expect((await readTask(a.id)).rank).toBe(a.rank);
      expect((await readTask(b.id)).rank).toBe(b.rank);
    });

    it('drops a card between the two neighbours the UI reports', async () => {
      const a = await createTask(scratchId, 'A');
      const b = await createTask(scratchId, 'B');
      const c = await createTask(scratchId, 'C');

      // Both ids together, which is what dnd-kit's onDragEnd always sends
      // for a drop between two cards. Each id on its own is only *one*
      // bound — the other side falls back to a start/end sentinel — so a
      // single-sided payload means "somewhere after A", not "directly
      // after A", and that is by design (see resolveNeighborBounds).
      await user.agent
        .patch(`/api/v1/tasks/${c.id}/move`)
        .send({
          targetColumnId: scratchId,
          beforeTaskId: a.id,
          afterTaskId: b.id,
          expectedVersion: c.version,
        })
        .expect(200);

      expect(await titlesIn(scratchId)).toEqual(['A', 'C', 'B']);
    });

    it('treats a lone beforeTaskId as a lower bound only', async () => {
      const a = await createTask(scratchId, 'A');
      await createTask(scratchId, 'B');
      const c = await createTask(scratchId, 'C');

      await user.agent
        .patch(`/api/v1/tasks/${c.id}/move`)
        .send({
          targetColumnId: scratchId,
          beforeTaskId: a.id,
          expectedVersion: c.version,
        })
        .expect(200);

      // Guaranteed only to land after A — the upper bound is the end
      // sentinel, not B.
      const titles = await titlesIn(scratchId);
      expect(titles.indexOf('C')).toBeGreaterThan(titles.indexOf('A'));
    });

    it('appends to the end when neither neighbour is given', async () => {
      const a = await createTask(scratchId, 'A');
      await createTask(scratchId, 'B');

      await user.agent
        .patch(`/api/v1/tasks/${a.id}/move`)
        .send({ targetColumnId: scratchId, expectedVersion: a.version })
        .expect(200);

      expect(await titlesIn(scratchId)).toEqual(['B', 'A']);
    });

    it('keeps ordering stable across many midpoint inserts', async () => {
      const anchor = await createTask(scratchId, 'anchor');
      const top = await createTask(scratchId, 'top');
      await user.agent
        .patch(`/api/v1/tasks/${top.id}/move`)
        .send({
          targetColumnId: scratchId,
          afterTaskId: anchor.id,
          expectedVersion: top.version,
        })
        .expect(200);

      // Repeatedly split the same gap — the rank strings must stay distinct
      // and correctly ordered, rebalancing if they ever grow too long.
      for (let i = 0; i < 12; i++) {
        const card = await createTask(scratchId, `split-${i}`);
        await user.agent
          .patch(`/api/v1/tasks/${card.id}/move`)
          .send({
            targetColumnId: scratchId,
            beforeTaskId: top.id,
            afterTaskId: anchor.id,
            expectedVersion: card.version,
          })
          .expect(200);
      }

      const titles = await titlesIn(scratchId);
      expect(titles[0]).toBe('top');
      expect(titles[titles.length - 1]).toBe('anchor');
      expect(titles).toHaveLength(14);
      expect(new Set(titles).size).toBe(14);
    });
  });

  describe('cross-column move', () => {
    it('moves the task and its columnId together', async () => {
      const task = await createTask(todoId, 'crosser');
      const res = await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: doingId, expectedVersion: task.version })
        .expect(200);

      expect(res.body.columnId).toBe(doingId);
      expect(res.body.version).toBe(task.version + 1);
      expect(await titlesIn(doingId)).toContain('crosser');
      expect(await titlesIn(todoId)).not.toContain('crosser');
    });

    it('honours the brief\'s literal "specific position index"', async () => {
      const first = await createTask(doingId, 'pos-first');
      await createTask(doingId, 'pos-second');
      const mover = await createTask(doingId, 'pos-mover');

      // position 0 = the very top of the target column, resolved to
      // neighbours server-side inside the transaction (PLAN §3).
      await user.agent
        .patch(`/api/v1/tasks/${mover.id}/move`)
        .send({
          targetColumnId: doingId,
          position: 0,
          expectedVersion: mover.version,
        })
        .expect(200);

      expect((await titlesIn(doingId))[0]).toBe('pos-mover');
      expect((await readTask(first.id)).rank).toBeDefined();
    });
  });

  describe('optimistic concurrency (PLAN §3)', () => {
    it('409s a stale expectedVersion and hands back the corrected row', async () => {
      const task = await createTask(todoId, 'conflict-target');

      await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: doingId, expectedVersion: task.version })
        .expect(200);

      // Same version replayed — the client's view is now one move behind.
      const conflict = await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: todoId, expectedVersion: task.version })
        .expect(409);

      // Exact shape, no wrapper — the frontend reconciles from currentTask
      // without refetching the whole board.
      expect(Object.keys(conflict.body).sort()).toEqual([
        'currentTask',
        'error',
      ]);
      expect(conflict.body.error).toBe('VERSION_CONFLICT');
      expect(conflict.body.currentTask.id).toBe(task.id);
      expect(conflict.body.currentTask.version).toBe(task.version + 1);
      expect(conflict.body.currentTask.columnId).toBe(doingId);

      // The rejected move really was rejected — it did not half-apply.
      expect((await readTask(task.id)).columnId).toBe(doingId);
    });

    it('lets exactly one of five concurrent movers win', async () => {
      const task = await createTask(todoId, 'race-target');
      const anchor = await createTask(doingId, 'race-anchor');

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          user.agent
            .patch(`/api/v1/tasks/${task.id}/move`)
            .send({
              targetColumnId: doingId,
              beforeTaskId: anchor.id,
              expectedVersion: task.version,
            })
            .then((r) => r.status),
        ),
      );

      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(4);
      // Incremented exactly once despite five simultaneous attempts.
      expect((await readTask(task.id)).version).toBe(task.version + 1);
    });

    it('does not bump version on an ordinary title edit', async () => {
      const task = await createTask(todoId, 'edit-target');
      const edited = await user.agent
        .patch(`/api/v1/tasks/${task.id}`)
        .send({ title: 'edit-target renamed' })
        .expect(200);

      // Deliberate: version tracks *position*, so unrelated edits don't
      // manufacture false move-conflicts.
      expect(edited.body.version).toBe(task.version);
      await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: doingId, expectedVersion: task.version })
        .expect(200);
    });
  });

  describe('rejected targets', () => {
    it('400s INVALID_TARGET_COLUMN for a column on another board', async () => {
      const otherBoard = await user.agent
        .post('/api/v1/boards')
        .send({ title: 'Other board' })
        .expect(201);
      const foreignColumn = await user.agent
        .post(`/api/v1/boards/${otherBoard.body.id}/columns`)
        .send({ title: 'Foreign' })
        .expect(201);

      const task = await createTask(todoId, 'stayer');
      const res = await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({
          targetColumnId: foreignColumn.body.id,
          expectedVersion: task.version,
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('INVALID_TARGET_COLUMN');
      // Task.boardId can therefore never drift out of sync (PLAN §3).
      const after = await readTask(task.id);
      expect(after.columnId).toBe(todoId);
      expect(after.version).toBe(task.version);
    });

    it('400s a targetColumnId that exists nowhere', async () => {
      const task = await createTask(todoId, 'nowhere-mover');
      await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: randomUUID(), expectedVersion: task.version })
        .expect(400);
    });

    it('400s a payload missing expectedVersion, or with an unknown field', async () => {
      const task = await createTask(todoId, 'validation-target');
      await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({ targetColumnId: todoId })
        .expect(400);
      await user.agent
        .patch(`/api/v1/tasks/${task.id}/move`)
        .send({
          targetColumnId: todoId,
          expectedVersion: task.version,
          rank: 'zzz',
        })
        .expect(400);
    });

    it('self-heals when a neighbour id is stale', async () => {
      const doomed = await createTask(todoId, 'doomed-neighbour');
      const mover = await createTask(todoId, 'heal-mover');
      await user.agent.delete(`/api/v1/tasks/${doomed.id}`).expect(204);

      // The neighbour is gone; the move still lands rather than 500ing.
      await user.agent
        .patch(`/api/v1/tasks/${mover.id}/move`)
        .send({
          targetColumnId: todoId,
          beforeTaskId: doomed.id,
          expectedVersion: mover.version,
        })
        .expect(200);

      expect(await titlesIn(todoId)).toContain('heal-mover');
    });
  });
});
