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

- [ ] `POST /auth/register` — bcrypt cost 12, unique-email conflict → `409`
- [ ] `POST /auth/login` — sets `mk_at` (15 min, path `/`) and `mk_rt` (7 d, path `/api/v1/auth/refresh`), both `httpOnly`, `secure` in prod, `sameSite: 'lax'` (PLAN §1)
- [ ] `POST /auth/refresh` — verify SHA-256 hash → **rotate** (revoke old row, issue new) → detect reuse of a revoked token → revoke that user's whole token family
- [ ] `POST /auth/logout` — real server-side revocation, then clear both cookies
- [ ] `GET /auth/me` — current user for the app shell
- [ ] `GET /auth/ws-ticket` — **short-lived (~30 s), single-use token returned in the JSON body** for the Socket.IO handshake

> **Why the ws-ticket exists:** the access token is `httpOnly`, so browser JS can't read it to pass into
> `io(url, { auth: { token } })`, and a WebSocket upgrade to a *different* origin won't carry `SameSite=Lax`
> cookies either. The client fetches a ticket over the normal same-origin HTTP path (where the cookie works),
> then hands that ticket to Socket.IO. This is a refinement of PLAN §3 — it avoids trying to proxy a WS
> upgrade through Next.js rewrites, which is unreliable.

- [ ] `JwtAuthGuard` registered as `APP_GUARD` with a `@Public()` escape hatch (PLAN §4)
- [ ] Tight throttle on `/auth/login` + `/auth/register`: `@Throttle({ default: { ttl: 60_000, limit: 5 } })`

**Done when:** register → login → hit a protected route → refresh → logout → the old refresh token is rejected. All via REST client with a cookie jar.

---

## Phase 5 — Authorization primitives (~1.5 h) · *Day 2*

`src/common/guards/`, `src/common/decorators/`

- [ ] `BoardAccessGuard` — resolves `boardId` from `:boardId`, or via lookup from `:columnId` / `:taskId`; loads the caller's `BoardMember`; `403` if absent; attaches `req.boardRole` (PLAN §4)
- [ ] `RolesGuard` + `@RequireRole(BoardRole.EDITOR)`
- [ ] Guard order matters: `JwtAuthGuard` → `BoardAccessGuard` → `RolesGuard`

**Done when:** a task id belonging to someone else's board returns `403` on *every* task route, with no service code reached.

---

## Phase 6 — Boards & members (~2 h) · *Day 2*

- [ ] `POST /boards` — creates the board **and** the creator's `OWNER` `BoardMember` row *in one transaction* (PLAN §4 — single source of truth)
- [ ] `GET /boards` — cursor pagination on `(createdAt, id)`, `limit` default 20 (PLAN §2)
- [ ] `GET /boards/:id` — board + columns + tasks nested, ordered by `rank`; **every task must include `version`** or the frontend can't send `expectedVersion`
- [ ] `PATCH /boards/:id` (EDITOR+), `DELETE /boards/:id` (OWNER)
- [ ] `GET/POST/PATCH/DELETE /boards/:id/members` — OWNER only; share by email; **last-owner guard** on removal/demotion

---

## Phase 7 — Columns & the rank utility (~2 h) · *Day 2*

- [ ] `src/tasks/rank.util.ts` — `between(a, b)`, `first()`, `last()`, `rebalance(ranks)`; **pure functions, zero I/O**
- [ ] Unit-test it *before* wiring it up: midpoint, insert-at-start, insert-at-end, adjacent-strings, and a rebalance that preserves relative order
- [ ] `POST /boards/:id/columns`, `PATCH /columns/:id`, `DELETE /columns/:id`
- [ ] `PATCH /columns/:id/move` — same neighbour-id payload shape as task move (PLAN §3)

---

## Phase 8 — Tasks & the move endpoint (~3 h) · *Day 2 — the graded core*

- [ ] `POST /columns/:id/tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- [ ] `PATCH /tasks/:id/move` — the whole of PLAN §3:
  - [ ] accepts `beforeTaskId`/`afterTaskId` **and** `position` (the brief's literal "specific position index"); `position` resolves to neighbours server-side inside the transaction; neighbour ids win if both are sent
  - [ ] cross-board rejection → `400 INVALID_TARGET_COLUMN`
  - [ ] `prisma.$transaction(fn, { isolation: Prisma.TransactionIsolationLevel.Serializable })`
  - [ ] conditional write via `updateMany({ where: { id, version } })`, check `count === 0` → `409` with the fresh row
  - [ ] retry **once** on a Postgres serialization failure, then give up with `409`
  - [ ] trigger `rebalanceColumn()` when a computed rank exceeds ~40 chars
  - [ ] `Task.boardId` stays in sync inside the same transaction

**Done when:** two REST clients racing the same task produce exactly one `200` and one `409` carrying the corrected state.

---

## Phase 9 — WebSocket gateway (~1.5 h) · *Day 2*

`src/gateway/board.gateway.ts`

- [ ] Handshake validates the **ws-ticket** from Phase 4 (single-use, then discarded)
- [ ] `join` handler **re-runs the `BoardMember` check** before admitting the socket to `board:<boardId>` — a valid session is not authority to listen to a board (PLAN §3/§4)
- [ ] Emit `task.moved` / `task.created` / `task.updated` / `task.deleted` / `column.*` **after commit**, always including `version`
- [ ] Single instance, in-memory rooms — the Redis adapter is PLAN §7, not now

---

## Phase 10 — Audit log (~30 min) · *Day 4*

- [ ] `AuditService.log()` called from board share/unshare, role change, member removal, board deletion — **not** from task moves (PLAN §5)
- [ ] Log refresh-token reuse detection too, with `boardId: null`

---

## Phase 11 — Tests (~2–3 h) · *Day 4*

Small on purpose — the four things a reviewer will actually probe:

- [ ] `rank.util.spec.ts` (unit, from Phase 7)
- [ ] `auth.e2e-spec.ts` — register → login → refresh → logout
- [ ] `authz.e2e-spec.ts` — IDOR attempt returns `403`
- [ ] `move.e2e-spec.ts` — stale `expectedVersion` returns `409`; cross-board `targetColumnId` returns `400`

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

---

## Phase 14 — Deploy (~1 h) · *Day 4, optional*

**Railway or Render**, managed Postgres attached:

- [ ] Provision Postgres first; copy its connection string into `DATABASE_URL`
- [ ] Build: `npm ci && npx prisma generate && npm run build` · Start: `npx prisma migrate deploy && node dist/main.js`
- [ ] Set every var from Phase 13 — with **fresh** secrets, `NODE_ENV=production`, and `FRONTEND_URL` = the deployed frontend origin
- [ ] Health check path → `/api/v1/health`
- [ ] Confirm `secure: true` cookies are actually being set (the platform terminates TLS, so `trust proxy` must be on)

**Done when:** the deployed frontend can register, log in, and keep the session across a hard refresh — the check that catches cookie misconfiguration (PLAN §10).
