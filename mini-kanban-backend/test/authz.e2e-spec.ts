import { randomUUID } from 'crypto';
import { createE2eContext, E2eContext, E2eUser } from './e2e-harness';

/**
 * Backend ROADMAP Phase 11 / PLAN §4: every board-scoped route sits behind
 * `JwtAuthGuard → BoardAccessGuard → RolesGuard`. Two things are asserted
 * here — an outsider gets `403` on every one of them (IDOR), and an insider
 * gets `403` on the ones above their role.
 */
describe('Authorization (e2e)', () => {
  let ctx: E2eContext;
  let owner: E2eUser;
  let outsider: E2eUser;
  let boardId: string;
  let columnId: string;
  let taskId: string;

  beforeAll(async () => {
    ctx = await createE2eContext();
    owner = await ctx.signUp();
    outsider = await ctx.signUp();

    const board = await owner.agent
      .post('/api/v1/boards')
      .send({ title: 'Private board' })
      .expect(201);
    boardId = board.body.id;

    const column = await owner.agent
      .post(`/api/v1/boards/${boardId}/columns`)
      .send({ title: 'Todo' })
      .expect(201);
    columnId = column.body.id;

    const task = await owner.agent
      .post(`/api/v1/columns/${columnId}/tasks`)
      .send({ title: 'Secret task' })
      .expect(201);
    taskId = task.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('a non-member (IDOR)', () => {
    // Every board-scoped route, walked with a valid session that simply has
    // no BoardMember row. All 403 — none 404, none 200.
    const cases = (): Array<[string, () => Promise<unknown>]> => [
      [
        'GET   /boards/:id',
        () => outsider.agent.get(`/api/v1/boards/${boardId}`),
      ],
      [
        'PATCH /boards/:id',
        () =>
          outsider.agent
            .patch(`/api/v1/boards/${boardId}`)
            .send({ title: 'pwned' }),
      ],
      [
        'DELETE /boards/:id',
        () => outsider.agent.delete(`/api/v1/boards/${boardId}`),
      ],
      [
        'GET   /boards/:id/members',
        () => outsider.agent.get(`/api/v1/boards/${boardId}/members`),
      ],
      [
        'POST  /boards/:id/members',
        () =>
          outsider.agent
            .post(`/api/v1/boards/${boardId}/members`)
            .send({ email: outsider.email, role: 'OWNER' }),
      ],
      [
        'DELETE /boards/:id/members/:userId',
        () =>
          outsider.agent.delete(
            `/api/v1/boards/${boardId}/members/${owner.id}`,
          ),
      ],
      [
        'POST  /boards/:id/columns',
        () =>
          outsider.agent
            .post(`/api/v1/boards/${boardId}/columns`)
            .send({ title: 'injected' }),
      ],
      [
        'PATCH /columns/:id',
        () =>
          outsider.agent
            .patch(`/api/v1/columns/${columnId}`)
            .send({ title: 'pwned' }),
      ],
      [
        'DELETE /columns/:id',
        () => outsider.agent.delete(`/api/v1/columns/${columnId}`),
      ],
      [
        'PATCH /columns/:id/move',
        () => outsider.agent.patch(`/api/v1/columns/${columnId}/move`).send({}),
      ],
      [
        'POST  /columns/:id/tasks',
        () =>
          outsider.agent
            .post(`/api/v1/columns/${columnId}/tasks`)
            .send({ title: 'injected' }),
      ],
      [
        'PATCH /tasks/:id',
        () =>
          outsider.agent
            .patch(`/api/v1/tasks/${taskId}`)
            .send({ title: 'pwned' }),
      ],
      [
        'DELETE /tasks/:id',
        () => outsider.agent.delete(`/api/v1/tasks/${taskId}`),
      ],
      [
        'PATCH /tasks/:id/move',
        () =>
          outsider.agent
            .patch(`/api/v1/tasks/${taskId}/move`)
            .send({ targetColumnId: columnId, expectedVersion: 0 }),
      ],
    ];

    it.each(cases())('403s on %s', async (_label, call) => {
      const res = (await call()) as { status: number };
      expect(res.status).toBe(403);
    });

    it('leaves the board untouched after all of that', async () => {
      const board = await owner.agent
        .get(`/api/v1/boards/${boardId}`)
        .expect(200);
      expect(board.body.title).toBe('Private board');
      // Two seeded default columns plus the "Todo" this suite adds; the
      // assertion is by id, not index, so it says nothing about how many
      // columns a fresh board happens to open with.
      const column = board.body.columns.find(
        (c: { id: string }) => c.id === columnId,
      );
      expect(column).toBeDefined();
      expect(column.tasks).toHaveLength(1);
      expect(column.tasks[0].title).toBe('Secret task');
      expect(board.body.columns).toHaveLength(3);
    });

    it('never lists a board it has no membership on', async () => {
      const res = await outsider.agent.get('/api/v1/boards').expect(200);
      const ids = res.body.items.map((b: { id: string }) => b.id);
      expect(ids).not.toContain(boardId);
    });

    it('gives the same 403 for a board that does not exist — no not-found oracle', async () => {
      // A distinct 404 here would let an attacker tell "wrong id" apart from
      // "someone else's board" and enumerate real ids (PLAN §4).
      await outsider.agent.get(`/api/v1/boards/${randomUUID()}`).expect(403);
      await outsider.agent
        .patch(`/api/v1/tasks/${randomUUID()}`)
        .send({ title: 'x' })
        .expect(403);
      await outsider.agent
        .post(`/api/v1/columns/${randomUUID()}/tasks`)
        .send({ title: 'x' })
        .expect(403);
    });
  });

  describe('a VIEWER member', () => {
    let viewer: E2eUser;

    beforeAll(async () => {
      viewer = await ctx.signUp();
      await owner.agent
        .post(`/api/v1/boards/${boardId}/members`)
        .send({ email: viewer.email, role: 'VIEWER' })
        .expect(201);
    });

    it('can read the board and its member list', async () => {
      const board = await viewer.agent
        .get(`/api/v1/boards/${boardId}`)
        .expect(200);
      expect(board.body.role).toBe('VIEWER');
      // Any role may see who has access (PLAN §3's route table).
      await viewer.agent.get(`/api/v1/boards/${boardId}/members`).expect(200);
    });

    it('cannot write anything — every mutation is 403', async () => {
      await viewer.agent
        .patch(`/api/v1/boards/${boardId}`)
        .send({ title: 'nope' })
        .expect(403);
      await viewer.agent
        .post(`/api/v1/boards/${boardId}/columns`)
        .send({ title: 'nope' })
        .expect(403);
      await viewer.agent
        .post(`/api/v1/columns/${columnId}/tasks`)
        .send({ title: 'nope' })
        .expect(403);
      await viewer.agent
        .patch(`/api/v1/tasks/${taskId}`)
        .send({ title: 'nope' })
        .expect(403);
      await viewer.agent
        .patch(`/api/v1/tasks/${taskId}/move`)
        .send({ targetColumnId: columnId, expectedVersion: 0 })
        .expect(403);
      await viewer.agent.delete(`/api/v1/boards/${boardId}`).expect(403);
    });
  });

  describe('an EDITOR member', () => {
    let editor: E2eUser;

    beforeAll(async () => {
      editor = await ctx.signUp();
      await owner.agent
        .post(`/api/v1/boards/${boardId}/members`)
        .send({ email: editor.email, role: 'EDITOR' })
        .expect(201);
    });

    it('can mutate board content', async () => {
      const column = await editor.agent
        .post(`/api/v1/boards/${boardId}/columns`)
        .send({ title: 'Editor column' })
        .expect(201);
      await editor.agent
        .post(`/api/v1/columns/${column.body.id}/tasks`)
        .send({ title: 'Editor task' })
        .expect(201);
      await editor.agent
        .patch(`/api/v1/boards/${boardId}`)
        .send({ description: 'edited' })
        .expect(200);
      await editor.agent
        .delete(`/api/v1/columns/${column.body.id}`)
        .expect(204);
    });

    it('cannot do OWNER-only things: share, change roles, delete the board', async () => {
      await editor.agent
        .post(`/api/v1/boards/${boardId}/members`)
        .send({ email: outsider.email, role: 'EDITOR' })
        .expect(403);
      await editor.agent
        .patch(`/api/v1/boards/${boardId}/members/${editor.id}`)
        .send({ role: 'OWNER' })
        .expect(403);
      await editor.agent
        .delete(`/api/v1/boards/${boardId}/members/${owner.id}`)
        .expect(403);
      await editor.agent.delete(`/api/v1/boards/${boardId}`).expect(403);
    });
  });

  describe('the last-owner guard (PLAN §4)', () => {
    it('refuses to demote or remove the only owner', async () => {
      await owner.agent
        .patch(`/api/v1/boards/${boardId}/members/${owner.id}`)
        .send({ role: 'EDITOR' })
        .expect(409);
      await owner.agent
        .delete(`/api/v1/boards/${boardId}/members/${owner.id}`)
        .expect(409);

      // Still OWNER, still able to act as one.
      const board = await owner.agent
        .get(`/api/v1/boards/${boardId}`)
        .expect(200);
      expect(board.body.role).toBe('OWNER');
    });

    it('allows it once a second owner exists', async () => {
      const coOwner = await ctx.signUp();
      await owner.agent
        .post(`/api/v1/boards/${boardId}/members`)
        .send({ email: coOwner.email, role: 'OWNER' })
        .expect(201);

      await owner.agent
        .patch(`/api/v1/boards/${boardId}/members/${owner.id}`)
        .send({ role: 'EDITOR' })
        .expect(200);

      // Demoted for real: the OWNER-only route is now closed to them.
      await owner.agent.delete(`/api/v1/boards/${boardId}`).expect(403);

      // Restore, so later cleanup still has an owner to act through.
      await coOwner.agent
        .patch(`/api/v1/boards/${boardId}/members/${owner.id}`)
        .send({ role: 'OWNER' })
        .expect(200);
    });

    it('hands Board.ownerId to a surviving OWNER when the recorded one is demoted', async () => {
      const solo = await ctx.signUp();
      const board = await solo.agent
        .post('/api/v1/boards')
        .send({ title: 'Succession by demotion' })
        .expect(201);
      expect(board.body.ownerId).toBe(solo.id);

      const heir = await ctx.signUp();
      await solo.agent
        .post(`/api/v1/boards/${board.body.id}/members`)
        .send({ email: heir.email, role: 'OWNER' })
        .expect(201);
      await solo.agent
        .patch(`/api/v1/boards/${board.body.id}/members/${solo.id}`)
        .send({ role: 'VIEWER' })
        .expect(200);

      // `ownerId` must not go on naming a member the guard chain would now
      // refuse as an OWNER — it follows the membership table.
      const after = await heir.agent
        .get(`/api/v1/boards/${board.body.id}`)
        .expect(200);
      expect(after.body.ownerId).toBe(heir.id);
    });

    it('hands Board.ownerId over when the recorded owner is removed outright', async () => {
      const solo = await ctx.signUp();
      const board = await solo.agent
        .post('/api/v1/boards')
        .send({ title: 'Succession by removal' })
        .expect(201);

      const heir = await ctx.signUp();
      await solo.agent
        .post(`/api/v1/boards/${board.body.id}/members`)
        .send({ email: heir.email, role: 'OWNER' })
        .expect(201);
      await heir.agent
        .delete(`/api/v1/boards/${board.body.id}/members/${solo.id}`)
        .expect(204);

      const after = await heir.agent
        .get(`/api/v1/boards/${board.body.id}`)
        .expect(200);
      // The removed user isn't even a member any more, so this is the case
      // where a stale ownerId would have been most misleading.
      expect(after.body.ownerId).toBe(heir.id);
    });

    it('leaves Board.ownerId alone when a non-owner member changes role', async () => {
      const solo = await ctx.signUp();
      const board = await solo.agent
        .post('/api/v1/boards')
        .send({ title: 'Owner unaffected' })
        .expect(201);

      const helper = await ctx.signUp();
      await solo.agent
        .post(`/api/v1/boards/${board.body.id}/members`)
        .send({ email: helper.email, role: 'EDITOR' })
        .expect(201);
      await solo.agent
        .patch(`/api/v1/boards/${board.body.id}/members/${helper.id}`)
        .send({ role: 'VIEWER' })
        .expect(200);

      const after = await solo.agent
        .get(`/api/v1/boards/${board.body.id}`)
        .expect(200);
      expect(after.body.ownerId).toBe(solo.id);
    });
  });

  describe('revoked access', () => {
    it('cuts a member off the moment they are unshared', async () => {
      const guest = await ctx.signUp();
      await owner.agent
        .post(`/api/v1/boards/${boardId}/members`)
        .send({ email: guest.email, role: 'EDITOR' })
        .expect(201);
      await guest.agent.get(`/api/v1/boards/${boardId}`).expect(200);

      await owner.agent
        .delete(`/api/v1/boards/${boardId}/members/${guest.id}`)
        .expect(204);

      // Same still-valid session, no longer any access — authorization is
      // re-checked per request, not baked into the token.
      await guest.agent.get(`/api/v1/boards/${boardId}`).expect(403);
      await guest.agent
        .patch(`/api/v1/tasks/${taskId}`)
        .send({ title: 'nope' })
        .expect(403);
    });
  });
});
