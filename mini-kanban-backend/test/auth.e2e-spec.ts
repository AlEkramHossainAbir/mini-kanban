import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/auth/auth.constants';
import {
  cookieValue,
  createE2eContext,
  E2eContext,
  E2E_PASSWORD,
  setCookie,
} from './e2e-harness';

// Backend ROADMAP Phase 11: register → login → refresh → logout, end to end
// against a real database. The cookie assertions are the point — PLAN §1 puts
// the whole session in httpOnly cookies, so a token appearing in a response
// *body* would be a regression, not a convenience.
describe('Auth (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('the happy path', () => {
    it('registers → logs in → refreshes → logs out', async () => {
      const email = `e2e-flow-${Date.now()}@example.test`;
      const agent = ctx.client();

      const registered = await agent
        .post('/api/v1/auth/register')
        .send({ email, password: E2E_PASSWORD, name: 'Flow User' })
        .expect(201);

      expect(registered.body).toEqual({
        id: expect.any(String),
        email,
        name: 'Flow User',
      });
      // Registration authenticates nobody — no session is handed out here.
      expect(registered.headers['set-cookie']).toBeUndefined();
      expect(registered.body).not.toHaveProperty('passwordHash');

      const loggedIn = await agent
        .post('/api/v1/auth/login')
        .send({ email, password: E2E_PASSWORD })
        .expect(200);

      const at = setCookie(loggedIn, ACCESS_COOKIE);
      const rt = setCookie(loggedIn, REFRESH_COOKIE);
      expect(at).toContain('HttpOnly');
      expect(at).toContain('SameSite=Lax');
      expect(rt).toContain('HttpOnly');
      // Scoped tight (PLAN §1): the refresh token is sent to exactly one route.
      expect(rt).toContain('Path=/api/v1/auth/refresh');
      // Nothing bearer-ish in the body — the browser never sees a raw token.
      expect(JSON.stringify(loggedIn.body)).not.toMatch(/eyJ/);

      await agent.get('/api/v1/auth/me').expect(200).expect({
        id: registered.body.id,
        email,
        name: 'Flow User',
      });

      const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
      expect(refreshed.body.id).toBe(registered.body.id);
      // Rotation: a genuinely different refresh token comes back.
      const rotated = setCookie(refreshed, REFRESH_COOKIE);
      expect(rotated).toBeDefined();
      expect(cookieValue(rotated!)).not.toBe(cookieValue(rt!));
      expect(cookieValue(rotated!)).not.toBe('');

      // Still authenticated on the rotated session.
      await agent.get('/api/v1/auth/me').expect(200);

      const loggedOut = await agent.post('/api/v1/auth/logout').expect(200);
      expect(loggedOut.body).toEqual({ success: true });
      expect(cookieValue(setCookie(loggedOut, ACCESS_COOKIE)!)).toBe('');
      expect(cookieValue(setCookie(loggedOut, REFRESH_COOKIE)!)).toBe('');

      // Logout is real server-side revocation, not just a cleared cookie.
      const live = await ctx.prisma.refreshToken.count({
        where: { userId: registered.body.id, revokedAt: null },
      });
      expect(live).toBe(0);

      await agent.get('/api/v1/auth/me').expect(401);

      await ctx.prisma.auditLog.deleteMany({
        where: { userId: registered.body.id },
      });
      await ctx.prisma.user.delete({ where: { id: registered.body.id } });
    });
  });

  describe('registration', () => {
    it('rejects a duplicate email with 409', async () => {
      const user = await ctx.signUp();
      await ctx
        .client()
        .post('/api/v1/auth/register')
        .send({ email: user.email, password: E2E_PASSWORD, name: 'Twin' })
        .expect(409);
    });

    it('rejects a weak password and an unknown field (whitelist pipe, PLAN §5)', async () => {
      const agent = ctx.client();

      await agent
        .post('/api/v1/auth/register')
        .send({ email: 'weak@example.test', password: 'short', name: 'W' })
        .expect(400);

      // forbidNonWhitelisted is the mass-assignment defence — a caller must
      // not be able to smuggle extra columns in through the DTO.
      await agent
        .post('/api/v1/auth/register')
        .send({
          email: `inject-${Date.now()}@example.test`,
          password: E2E_PASSWORD,
          name: 'I',
          isAdmin: true,
        })
        .expect(400);
    });
  });

  describe('login', () => {
    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const user = await ctx.signUp();
      const agent = ctx.client();

      const wrongPassword = await agent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'NotThePassword!1' })
        .expect(401);

      const unknownEmail = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.test', password: E2E_PASSWORD })
        .expect(401);

      // Identical message: never tell an attacker which half was wrong.
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('refresh-token rotation', () => {
    it('burns the whole family when a revoked token is replayed (PLAN §1)', async () => {
      const user = await ctx.signUp();

      // Fresh agents throughout: each has an empty cookie jar, so the
      // explicit Cookie header below is unambiguously the token under test.
      const login = await ctx
        .client()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: E2E_PASSWORD })
        .expect(200);
      const staleRefresh = setCookie(login, REFRESH_COOKIE)!.split(';')[0];

      await ctx
        .client()
        .post('/api/v1/auth/refresh')
        .set('Cookie', staleRefresh)
        .expect(200);

      // Replaying the now-revoked token is the reuse signal.
      await ctx
        .client()
        .post('/api/v1/auth/refresh')
        .set('Cookie', staleRefresh)
        .expect(401);

      // Every live token for that user is revoked, not just the replayed one.
      const live = await ctx.prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(live).toBe(0);

      // ...and the incident is audited with a null boardId (Phase 10).
      const audited = await ctx.prisma.auditLog.findFirst({
        where: { userId: user.id, action: 'REFRESH_TOKEN_REUSE' },
      });
      expect(audited).not.toBeNull();
      expect(audited!.boardId).toBeNull();
    });

    it('rejects a refresh with no cookie at all', async () => {
      await ctx.client().post('/api/v1/auth/refresh').expect(401);
    });
  });

  describe('protected routes', () => {
    it('401s without a session and accepts one with', async () => {
      const anon = ctx.client();
      await anon.get('/api/v1/auth/me').expect(401);
      await anon.get('/api/v1/boards').expect(401);

      const user = await ctx.signUp();
      await user.agent.get('/api/v1/boards').expect(200);
    });

    it('issues a single-use ws-ticket in the body, not a cookie (PLAN §3)', async () => {
      const user = await ctx.signUp();
      const res = await user.agent.get('/api/v1/auth/ws-ticket').expect(200);

      expect(res.body.ticket).toEqual(expect.any(String));
      expect(res.body.expiresIn).toBeGreaterThan(0);
      // Socket.IO can't read httpOnly cookies, which is the whole reason this
      // endpoint exists — so the ticket has to come back in the body.
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('CSRF (PLAN §5)', () => {
    // The header only defends anything if the server actually checks it. Before
    // CsrfGuard existed, the frontend sent it and a mutation sent *without* it
    // was still accepted — these specs are what keep that from regressing.
    it('403s a state-changing request that carries no X-Requested-With header', async () => {
      const user = await ctx.signUp();

      const res = await user.agent
        .post('/api/v1/boards')
        .set('X-Requested-With', '')
        .send({ title: 'csrf probe' });

      expect(res.status).toBe(403);
      // And nothing was created as a side effect of the rejected request.
      const boards = await user.agent.get('/api/v1/boards').expect(200);
      expect(boards.body.items).toHaveLength(0);
    });

    it('allows the same request once the header is present', async () => {
      const user = await ctx.signUp();
      await user.agent
        .post('/api/v1/boards')
        .send({ title: 'with header' })
        .expect(201);
    });

    it('leaves safe methods alone — GET needs no header', async () => {
      const user = await ctx.signUp();
      await user.agent
        .get('/api/v1/boards')
        .set('X-Requested-With', '')
        .expect(200);
    });

    it('rejects before authentication, so it cannot be probed with a bad session', async () => {
      // No cookies on this agent at all: the CSRF rejection (403) must win over
      // the missing-session rejection (401), proving the guard runs first.
      const anon = ctx.client();
      const res = await anon
        .post('/api/v1/boards')
        .set('X-Requested-With', '')
        .send({ title: 'nope' });

      expect(res.status).toBe(403);
    });
  });

  describe('rate limiting', () => {
    it('429s the 6th login attempt in a minute (5/min, PLAN §5)', async () => {
      // Its own agent, so its own source IP and its own fresh counter.
      const attacker = ctx.client();
      const codes: number[] = [];

      for (let i = 0; i < 6; i++) {
        const res = await attacker
          .post('/api/v1/auth/login')
          .send({ email: 'brute@example.test', password: 'Wrong!12345' });
        codes.push(res.status);
      }

      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes[5]).toBe(429);
    });
  });
});
