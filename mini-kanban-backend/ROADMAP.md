# Backend Roadmap — NestJS + Prisma + PostgreSQL

Execution roadmap for the Mini Kanban backend, from an empty folder to a deployed API.
Design decisions and their justifications live in [`PLAN_EN.md`](../PLAN_EN.md) (`§` references below point there) — this file is the *order of operations*.

**Target:** Node 20 LTS · NestJS 10 · Prisma 6 · PostgreSQL 16
**Serves:** `http://localhost:4000/api/v1`

---

## Phase 0 — Scaffold (~20 min)

```bash
cd mini-kanban-backend
npx @nestjs/cli new . --package-manager npm --skip-git
```

> If the CLI refuses because the folder isn't empty, scaffold into a temp dir and move everything in:
> `npx @nestjs/cli new tmp-api --package-manager npm --skip-git && mv tmp-api/* tmp-api/.[!.]* . && rmdir tmp-api`

- [x] `npm run start:dev` serves the default Nest hello-world on `:3000`
- [x] Change the port to **4000** in `src/main.ts` (3000 belongs to Next.js)

---

## Phase 1 — Dependencies (~10 min)

```bash
# runtime
npm i @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt \
      @nestjs/throttler @nestjs/websockets @nestjs/platform-socket.io socket.io \
      @prisma/client class-validator class-transformer \
      cookie-parser helmet bcrypt nestjs-pino pino-http

# dev
npm i -D prisma @types/passport-jwt @types/cookie-parser @types/bcrypt pino-pretty
```

`jest`, `supertest` and `@nestjs/testing` already ship with the Nest scaffold.

> **Gotcha — `bcrypt` is a native module.** It needs a build toolchain on Alpine (musl has no prebuilds).
> Either build on Debian (`node:20-bookworm-slim`, prebuilds work — this is what Phase 11 does), or swap to
> `bcryptjs` (pure JS, no toolchain, slightly slower). Don't discover this at Docker-build time on day 4.

- [x] `npm ls bcrypt` resolves without a build error

---

## Phase 2 — Prisma schema & first migration (~45 min)

```bash
npx prisma init --datasource-provider postgresql
```

- [x] Copy the full schema from **PLAN §2** into `prisma/schema.prisma` — `User`, `RefreshToken`, `Board`, `BoardRole`, `BoardMember`, `Column`, `Task`, `AuditLog`, with **every `@@index`/`@@unique` exactly as written** (they're load-bearing, see PLAN §2 and §7.8)
- [x] `DATABASE_URL` in `.env` → `postgresql://kanban:kanban@localhost:5432/kanban?schema=public`
- [x] Start a throwaway Postgres for local dev:
      `docker run --name kanban-db -e POSTGRES_USER=kanban -e POSTGRES_PASSWORD=kanban -e POSTGRES_DB=kanban -p 5432:5432 -d postgres:16-alpine`

```bash
npx prisma migrate dev --name init
npx prisma generate
npx prisma studio          # eyeball the tables
```

- [x] Commit `prisma/migrations/` — the deploy step replays these, never `db push`

---

## Phase 3 — App-wide wiring (~1 h)

`src/common/` — `PrismaModule` + `PrismaService` (`onModuleInit` → `$connect`), a global `HttpExceptionFilter`, and the guards/decorators added in Phase 5.

`src/main.ts` must set all of this up:

- [x] `app.setGlobalPrefix('api/v1')`
- [x] `app.use(cookieParser())`
- [x] `app.use(helmet())` (PLAN §5)
- [x] `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` (PLAN §5 — this is the mass-assignment defence, don't soften it)
- [x] `app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true })` — **local dev only**; production runs same-origin behind the Next.js rewrite (PLAN §1)
- [x] `app.set('trust proxy', 1)` — without this the throttler sees the load balancer's IP and rate-limits everyone as one client
- [x] `app.enableShutdownHooks()`
- [x] `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` globally *(v6+ takes an array and `ttl` in **milliseconds**)*
- [x] `GET /api/v1/health` → `{ status: 'ok' }`, no auth — Docker healthcheck + Render/Railway probes need it

**Done when:** `curl localhost:4000/api/v1/health` returns 200 with security headers present. ✅ Verified — 200, `{"status":"ok"}`, full helmet header set, CORS + rate-limit headers present.

---

## Phase 4 — Auth module (~3 h) · *Day 1*

`src/auth/` — controller, service, `jwt.strategy.ts`, DTOs.

- [x] `POST /auth/register` — bcrypt cost 12, unique-email conflict → `409`
- [x] `POST /auth/login` — sets `mk_at` (15 min, path `/`) and `mk_rt` (7 d, path `/api/v1/auth/refresh`), both `httpOnly`, `secure` in prod, `sameSite: 'lax'` (PLAN §1)
- [x] `POST /auth/refresh` — verify SHA-256 hash → **rotate** (revoke old row, issue new) → detect reuse of a revoked token → revoke that user's whole token family
- [x] `POST /auth/logout` — real server-side revocation, then clear both cookies
- [x] `GET /auth/me` — current user for the app shell
- [x] `GET /auth/ws-ticket` — **short-lived (~30 s), single-use token returned in the JSON body** for the Socket.IO handshake

> **Why the ws-ticket exists:** the access token is `httpOnly`, so browser JS can't read it to pass into
> `io(url, { auth: { token } })`, and a WebSocket upgrade to a *different* origin won't carry `SameSite=Lax`
> cookies either. The client fetches a ticket over the normal same-origin HTTP path (where the cookie works),
> then hands that ticket to Socket.IO. This is a refinement of PLAN §3 — it avoids trying to proxy a WS
> upgrade through Next.js rewrites, which is unreliable.

- [x] `JwtAuthGuard` registered as `APP_GUARD` with a `@Public()` escape hatch (PLAN §4)
- [x] Tight throttle on `/auth/login` + `/auth/register`: `@Throttle({ default: { ttl: 60_000, limit: 5 } })`

**Done when:** register → login → hit a protected route → refresh → logout → the old refresh token is rejected. All via REST client with a cookie jar. ✅ Verified with curl + a cookie jar against a live Postgres: register → 409 on duplicate email → 401 on `/auth/me` with no cookie → login sets `mk_at`/`mk_rt` with the correct paths → `/auth/me` succeeds → refresh rotates the token and the old one now gets `401 "Session revoked"` on replay → logout revokes and `/auth/me` afterward is `401`.

---

## Phase 5 — Authorization primitives (~1.5 h) · *Day 2*

`src/common/guards/`, `src/common/decorators/`

- [x] `BoardAccessGuard` — resolves `boardId` from `:boardId`, or via lookup from `:columnId` / `:taskId`; loads the caller's `BoardMember`; `403` if absent; attaches `req.boardRole` (PLAN §4)
- [x] `RolesGuard` + `@RequireRole(BoardRole.EDITOR)`
- [x] Guard order matters: `JwtAuthGuard` → `BoardAccessGuard` → `RolesGuard`

**Done when:** a task id belonging to someone else's board returns `403` on *every* task route, with no service code reached. ✅ Verified now via unit tests (`board-access.guard.spec.ts`, `roles.guard.spec.ts`, 14 tests) with a stubbed Prisma — including the exact scenario, a `:taskId` resolving to a board the caller has no `BoardMember` row on. There are no real task routes yet (Phases 6–8 build `BoardsController`/`ColumnsController`/`TasksController`); those phases apply `@UseGuards(BoardAccessGuard, RolesGuard)` and must name their id params `:boardId`/`:columnId`/`:taskId` per this guard's contract (documented in its docblock) for the lookup to work — full route-level verification (`authz.e2e-spec.ts`) happens in Phase 11 once those routes exist.

---

## Phase 6 — Boards & members (~2 h) · *Day 2*

- [x] `POST /boards` — creates the board **and** the creator's `OWNER` `BoardMember` row *in one transaction* (PLAN §4 — single source of truth)
- [x] `GET /boards` — cursor pagination on `(createdAt, id)`, `limit` default 20 (PLAN §2)
- [x] `GET /boards/:id` — board + columns + tasks nested, ordered by `rank`; **every task must include `version`** or the frontend can't send `expectedVersion`
- [x] `PATCH /boards/:id` (EDITOR+), `DELETE /boards/:id` (OWNER)
- [x] `GET/POST/PATCH/DELETE /boards/:id/members` — `GET` is member-only per PLAN §3's table (any role can see who has access); `POST`/`PATCH`/`DELETE` are OWNER only; share by email; **last-owner guard** on removal/demotion

**Verified live** against Postgres with two real users (curl + cookie jars): board create → OWNER auto-membership → list shows `role` per board → outsider gets `403` on the board and on `PATCH` → share by email → duplicate share `409` → unregistered email `404` → VIEWER can read but `403` on `PATCH`/add-member → promoted to EDITOR → EDITOR's `PATCH` succeeds → self-removing the sole OWNER → `409` (last-owner guard) → removing a member → `204`, and their access is immediately `403` → cursor pagination across 3 boards splits/resumes correctly, newest-first, and a garbage cursor → `400` → deleting a board (OWNER) → `204`, and it then reads back as `403` (folded into the same not-found-vs-forbidden guard behavior from Phase 5, not a distinguishing `404`). `npm run test`, `test:e2e`, and `lint` all clean.

---

## Phase 7 — Columns & the rank utility (~2 h) · *Day 2*

- [x] `src/tasks/rank.util.ts` — `between(a, b)`, `first()`, `last()`, `rebalance(ranks)`; **pure functions, zero I/O**
- [x] Unit-test it *before* wiring it up: midpoint, insert-at-start, insert-at-end, adjacent-strings, and a rebalance that preserves relative order — 17 tests in `rank.util.spec.ts`
- [x] `POST /boards/:id/columns`, `PATCH /columns/:id`, `DELETE /columns/:id`
- [x] `PATCH /columns/:id/move` — same neighbour-id payload shape as task move (PLAN §3); no `targetColumnId` (columns don't cross boards) and no `expectedVersion` (`Column` has no `version` column — that rigor is task move's job, Phase 8's graded core)

**Verified live** against Postgres with two real users: create/rename/delete columns, cross-board 403, move via `position` and via neighbor ids, self-healing fallback to the sentinel boundary when a referenced neighbor id is stale. Along the way, found and fixed a real gap this exposed: `BoardsService.findOne()`'s nested `columns`/`tasks` `orderBy` was missing the `id` tiebreak PLAN §3 requires ("`ORDER BY rank, id`") — a live rank collision (expected/harmless per PLAN §3) made two columns' order nondeterministic until fixed. Also added `columns.service.spec.ts` to directly exercise the rebalance-trigger branch (mocked Prisma, a crafted >40-char boundary) since forcing it via pure repeated-insert-at-start over HTTP would need ~250+ round trips (confirmed the math: ~5.2 iterations per extra character at base-36, matching the ~10-char result actually observed after 45 real HTTP moves). Stress-tested with 47 real columns after heavy reordering: order still matches `sorted(ranks)` with duplicate ranks present, confirming id-tiebreak correctness at scale. `npm run test` (33 tests), `test:e2e`, and `lint` all clean.

---

## Phase 8 — Tasks & the move endpoint (~3 h) · *Day 2 — the graded core*

- [x] `POST /columns/:id/tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- [x] `PATCH /tasks/:id/move` — the whole of PLAN §3:
  - [x] accepts `beforeTaskId`/`afterTaskId` **and** `position` (the brief's literal "specific position index"); `position` resolves to neighbours server-side inside the transaction; neighbour ids win if both are sent
  - [x] cross-board rejection → `400 INVALID_TARGET_COLUMN`
  - [x] `prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` — note: the actual Prisma 6 option key is `isolationLevel`, not `isolation` as this line originally read; caught by the TS build, fixed
  - [x] conditional write via `updateMany({ where: { id, version } })`, check `count === 0` → `409` with the fresh row
  - [x] retry **once** on a Postgres serialization failure, then give up with `409`
  - [x] trigger `rebalanceColumn()` when a computed rank exceeds ~40 chars — scoped to the *target* column only, via `resolveNeighborBounds`/`rebalance` shared with column move (extracted into `rank.util.ts` this phase to deduplicate identical logic — PLAN §3 already calls it "the same rank utility")
  - [x] `Task.boardId` stays in sync inside the same transaction — achieved by never letting it need to change: the cross-board check above rejects the one operation that could ever make it drift, before any transaction starts

**Done when:** two REST clients racing the same task produce exactly one `200` and one `409` carrying the corrected state. ✅ Verified live against Postgres: fired 2 concurrent `PATCH /tasks/:id/move` requests at the same task (same `expectedVersion`) → exactly one `200`, one `409` with the corrected `currentTask`; repeated with **5** concurrent clients → exactly one `200`, four `409`s, `version` incremented exactly once (2→3) despite 5 simultaneous attempts. Also verified: same-column reorder, cross-column move, the exact `{error: 'VERSION_CONFLICT', currentTask}` response shape with no wrapper (required a route-scoped `TaskVersionConflictFilter`, since the global exception filter would have clobbered it into its own `{statusCode,path,timestamp,message}` shape), cross-board rejection (`400 INVALID_TARGET_COLUMN`), self-healing on a stale neighbor id, cross-board `403` for a non-member, and that a plain title edit does *not* bump `version` (deliberate — see `tasks.service.ts`, avoids manufacturing false move-conflicts for unrelated edits). The retry-on-serialization-failure path (P2034) is exercised by `tasks.service.spec.ts` (mocked Prisma) rather than live, since reliably forcing a genuine Postgres serialization failure on demand isn't practical from a curl script. `npm run test` (48 tests), `test:e2e`, and `lint` all clean.

---

## Phase 9 — WebSocket gateway (~1.5 h) · *Day 2*

`src/gateway/board.gateway.ts`

- [x] Handshake validates the **ws-ticket** from Phase 4 (single-use, then discarded) — implemented
      as Socket.IO **middleware** (`afterInit` → `server.use`), so rejection happens *during* the
      handshake and an unauthenticated socket is never admitted even briefly. Rejecting inside
      `handleConnection` instead would let the client fire `connect` first and only then be kicked;
      the middleware gives the frontend a plain `connect_error` to handle (frontend Phase 10).
      One opaque `INVALID_TICKET` reason — never leaks missing vs. expired vs. already-spent.
- [x] `join` handler **re-runs the `BoardMember` check** before admitting the socket to `board:<boardId>` — a valid session is not authority to listen to a board (PLAN §3/§4)
- [x] Emit `task.moved` / `task.created` / `task.updated` / `task.deleted` / `column.*` **after commit**, always including `version` — 8 events total. `task.moved` is emitted by a
      `broadcastMove()` wrapper *outside* the `$transaction`, so a rolled-back or `409`-rejected
      move broadcasts nothing at all.
- [x] Single instance, in-memory rooms — the Redis adapter is PLAN §7, not now

**Verified live** with a real `socket.io-client` — 25 checks, all passing: no ticket / bogus ticket /
**replayed** ticket all rejected with `INVALID_TICKET` (proving single-use); member `join` returns
`{ok, role}`; unknown board and non-member `join` both return `FORBIDDEN`; all 8 event types
received with correct `version`/`columnId`/`title`; a `409` conflict emits **no** `task.moved`; a
non-member socket that was refused the room receives nothing while the board is actively mutated;
`leave` stops delivery. `socket.io-client` added as a backend devDependency for this.

---

## Phase 10 — Audit log (~30 min) · *Day 4*

- [x] `AuditService.log()` called from board share/unshare, role change, member removal, board deletion — **not** from task moves (PLAN §5). `src/audit/` — a service, a closed
      `AuditAction`/`AuditEntity` set, and a module imported by `BoardsModule` + `AuthModule`.
      Every call sites fires **after** its mutation has succeeded, so a rejected action (last-owner
      demotion, duplicate share, unknown email) records nothing.
- [x] Log refresh-token reuse detection too, with `boardId: null` — only for a genuinely *revoked*
      token being replayed; an expired-but-unrevoked one is ordinary session end, not an incident.
      Metadata carries the burned-session count, IP and user-agent.

Two decisions worth stating, both deliberate:

- **`log()` never throws.** The caller's mutation has already committed by the time it runs, so a
  failed audit *insert* must not turn a successful share into a `500` that tells the client its
  action didn't happen. A lost row is `Logger.error`'d instead (PLAN §7.5 queues this off the
  request path later).
- **`assertLastOwnerSafe()` now returns the pre-mutation membership row** rather than `void` — the
  `ROLE_CHANGE`/`BOARD_UNSHARE` entries need the role it changed *from*, and that row is gone or
  overwritten by the time the caller logs. Costs one extra `findUnique` on promote-to-OWNER, which
  previously short-circuited before any lookup.

**Verified live** against Postgres: share → `ROLE_CHANGE` → unshare → refresh-token replay →
board delete produced exactly **5** rows with the right actor, target, `boardId` and metadata —
and column/task creation, a successful `PATCH /tasks/:id/move`, login and register produced
**none**, per PLAN §5's "not routine task moves". `BOARD_DELETE` survives its board's deletion
(`boardId` is denormalized, not a FK — PLAN §2); `REFRESH_TOKEN_REUSE` has `boardId: null`.
Negative pass: `404` unknown email, `409` duplicate share, `404` remove-non-member and the `409`
last-owner demotion added **0** rows between them. `npm run test` (65 tests, 3 new in
`audit.service.spec.ts`), `lint` and `build` all clean.

---

## Phase 11 — Tests (~2–3 h) · *Day 4*

Small on purpose — the four things a reviewer will actually probe:

- [x] `rank.util.spec.ts` (unit, from Phase 7) — landed early, in Phase 7, along with
      `columns.service.spec.ts`, `tasks.service.spec.ts` and `env.validation.spec.ts`
      (62 unit tests total)
- [ ] `auth.e2e-spec.ts` — register → login → refresh → logout
- [ ] `authz.e2e-spec.ts` — IDOR attempt returns `403`
- [ ] `move.e2e-spec.ts` — stale `expectedVersion` returns `409`; cross-board `targetColumnId` returns `400`

> All three e2e specs above are currently covered *manually* — a 125-check scripted audit against a
> live instance (auth, IDOR, roles, boards/members, columns, tasks, move, cascades, security
> headers) plus an 8-way concurrent move race that produced exactly one `200` and seven `409`s.
> They still need to be committed as automated Jest e2e specs for this phase to close.

```bash
npm run test        # unit
npm run test:e2e    # integration
```

---

## Phase 12 — Dockerfile (~45 min)

```dockerfile
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 4000
CMD ["sh","-c","npx prisma migrate deploy && node dist/main.js"]
```

- [ ] `.dockerignore`: `node_modules`, `dist`, `.env`, `.git`
- [ ] Image builds clean from a fresh clone

---

## Phase 13 — Environment variables

Commit as `.env.example` (never the real `.env`):

```bash
DATABASE_URL="postgresql://kanban:kanban@localhost:5432/kanban?schema=public"
JWT_ACCESS_SECRET="replace-with-32+-random-bytes"
JWT_REFRESH_SECRET="replace-with-a-different-32+-random-bytes"
ACCESS_TOKEN_TTL="15m"
REFRESH_TOKEN_TTL="7d"
FRONTEND_URL="http://localhost:3000"
PORT=4000
NODE_ENV=development
```

Generate real ones with `openssl rand -base64 32`.

- [x] **Validated at boot** — `src/common/env.validation.ts`, wired via
      `ConfigModule.forRoot({ validate })`. Requires `DATABASE_URL` + both JWT secrets, rejects
      the two secrets being identical (that would make the refresh-token HMAC key the same value
      that signs access tokens, PLAN §1), and rejects malformed TTLs. Under
      `NODE_ENV=production` it additionally rejects `.env.example` placeholders and secrets
      shorter than 32 chars. Deliberately lenient outside production so root ROADMAP Phase 3's
      `cp .env.example .env && docker compose up --build` still works with zero manual steps.
      Added after an audit found a missing `JWT_ACCESS_SECRET` let the app boot fine and only
      fail with a `500` on the first login.
- [x] `AuthModule` uses `JwtModule.registerAsync` so the secret is read at DI time. With plain
      `register()` it was read while the module was still being *imported* — before
      `ConfigModule` loads `.env` — and only worked because importing `@prisma/client` happens
      to load `.env` as a side effect.

---

## Phase 14 — Deploy (~1 h) · *Day 4, optional*

**Railway or Render**, managed Postgres attached:

- [ ] Provision Postgres first; copy its connection string into `DATABASE_URL`
- [ ] Build: `npm ci && npx prisma generate && npm run build` · Start: `npx prisma migrate deploy && node dist/main.js`
- [ ] Set every var from Phase 13 — with **fresh** secrets, `NODE_ENV=production`, and `FRONTEND_URL` = the deployed frontend origin
- [ ] Health check path → `/api/v1/health`
- [ ] Confirm `secure: true` cookies are actually being set (the platform terminates TLS, so `trust proxy` must be on)

**Done when:** the deployed frontend can register, log in, and keep the session across a hard refresh — the check that catches cookie misconfiguration (PLAN §10).
