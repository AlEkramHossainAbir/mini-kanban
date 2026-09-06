# Mini Kanban — Backend

The API for [Mini Kanban Board](../README.md): NestJS 10 + Prisma 6 on PostgreSQL 16, serving
boards, columns, and tasks behind cookie-based auth and a per-board role guard chain, plus a
Socket.IO gateway for realtime sync.

> This directory is one half of a single-repository submission. See the
> [root README](../README.md) for Docker quick start, the full API table, and architecture
> rationale; see [PLAN_EN.md](../PLAN_EN.md) for the system design this implements.

## Tech stack

- [NestJS 10](https://nestjs.com/) (TypeScript)
- [Prisma 6](https://www.prisma.io/) on PostgreSQL 16
- [Socket.IO](https://socket.io/) via `@nestjs/websockets` for realtime board updates
- Jest for unit + e2e tests

## Running standalone

Requires a running PostgreSQL instance (see the root README's
[Docker quick start](../README.md#quick-start-docker) to run the whole stack together instead).

```bash
cp .env.example .env   # then fill in DATABASE_URL and the two JWT secrets
npm install
npx prisma migrate deploy
npm run db:seed        # optional: creates the demo user (see root README)
npm run start:dev
```

The API listens on `:4000` behind the `/api/v1` global prefix — `GET /api/v1/health` returns
`{"status":"ok"}` once it's up.

## Environment variables

See [.env.example](.env.example) for the full annotated list. At minimum:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | must be two **different** random values — generate each with `openssl rand -base64 32`; the app refuses to boot in production if they match |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | token lifetimes, e.g. `15m` / `7d` |
| `FRONTEND_URL` | used for CORS and cookie scoping |
| `PORT` | defaults to `4000` |

Env vars are validated at boot (`src/common/env.validation.ts`) — a missing or malformed value
stops the process with a readable error in production, while staying lenient elsewhere so
`docker compose up` still works with the placeholder secrets in `.env.example`.

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | dev server with watch mode |
| `npm run build` / `npm run start:prod` | production build and run |
| `npm run lint` / `npm run typecheck` | ESLint and `tsc --noEmit` |
| `npm test` | unit tests (Jest) |
| `npm run test:e2e` | e2e tests against a live Postgres — set `DATABASE_URL`/`JWT_*` first |
| `npm run db:seed` | upserts the demo user and its sample board (safe to re-run) |

## Tests

67 unit tests cover the pure logic — rank-string ordering, guards, and services against mocks.
57 e2e tests boot the real `AppModule` through the same `configureApp()` as `main.ts` — the full
guard chain, validation pipe, rate limiter, and CSRF guard are all live — and pin down the graded
behavior directly: the `409` optimistic-concurrency conflict on `PATCH /tasks/:id/move`, five
concurrent movers resolving to exactly one winner, cross-board IDOR returning the same `403` as a
non-existent board, `VIEWER` blocked on every mutation, and the last-owner guard on member removal.

```bash
npm test        # unit
npm run test:e2e  # e2e — needs DATABASE_URL and JWT_* in the environment
```

## Architecture notes

- **Guard chain:** every board/column/task route runs `JwtAuthGuard → BoardAccessGuard →
  RolesGuard` — access is a `BoardMember` row (`OWNER` / `EDITOR` / `VIEWER`), checked fresh on
  every request, never a code path that can be skipped. See
  [PLAN_EN.md §4](../PLAN_EN.md#4-authorization--access-control).
- **Task movement:** `PATCH /tasks/:id/move` uses fractional rank strings for ordering (no row
  other than the moved one is ever rewritten) and optimistic concurrency via a `version` column,
  inside a `SERIALIZABLE` transaction. See
  [PLAN_EN.md §3](../PLAN_EN.md#3-api-surface--task-movement).
- **Security:** CSRF header guard, rate limiting, hardened cookies, and an audit log — see
  [PLAN_EN.md §5](../PLAN_EN.md#5-security-hardening).

The full endpoint table, sample env block, and Docker instructions live in the
[root README](../README.md) — this file covers only what's specific to running the backend on its
own.
