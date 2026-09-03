# System Design & Implementation Plan — Mini Kanban Board

**Scope note:** the official assessment (see [ASSESSMENT_EN.md](ASSESSMENT_EN.md)) is a 4-day take-home on a single-instance PostgreSQL stack. It does not ask for sharding or million-user SLAs. This plan is written in two layers on purpose:

- **Sections 1–6, 8** describe what is actually **built for the 4-day submission** — a correct, secure, well-architected MVP on the prescribed stack.
- **Section 7** is a **documented roadmap**, not code to write now — it explains how the same data model evolves toward very large scale (millions of users), so the design decisions made in the MVP (see the callouts) are shown to be compatible with that future, without over-engineering a take-home assessment.

---

## 1. System Architecture Overview

**Components**

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Backend | NestJS, TypeScript — modules: `AuthModule`, `UsersModule`, `BoardsModule`, `ColumnsModule`, `TasksModule`, `CommonModule` (guards/pipes/interceptors), `PrismaModule`, `GatewayModule` (WebSockets) |
| Database | PostgreSQL 16, accessed only through Prisma |
| Realtime | Socket.IO via `@nestjs/websockets`, single instance for MVP |
| DevOps | Docker Compose — `db`, `backend`, `frontend` services |

**Request flow**

Browser → Next.js (client components, server-rendered shell) → REST calls (`/api/v1/...`) → `JwtAuthGuard` → `BoardAccessGuard` → service layer → Prisma → PostgreSQL. Responses update a TanStack Query cache on the frontend; for drag-and-drop, the UI has already applied an optimistic update before the network response returns (§6).

**Auth flow — JWT access token + rotating refresh token, both in httpOnly cookies**

- **Access token**: JWT, 15-minute expiry, HS256, payload limited to `sub` (userId) + `email` + standard claims. Board roles are *not* embedded in the token — they're checked fresh from the database on every request, since membership can change more often than a 15-minute token should reflect.
- **Refresh token**: an opaque random 256-bit value (not a JWT), stored **hashed** (SHA-256) in a `RefreshToken` table with `expiresAt` (7 days), `revokedAt`, `replacedByTokenId`. Every use **rotates** the token (old row marked revoked, new row issued). If a revoked token is ever presented again, that's a signal of theft — the entire token family for that user is revoked immediately.
- **Storage decision: httpOnly, Secure, SameSite=Lax cookies**, not `localStorage`. Reasoning: `localStorage` is readable by any script running on the page, so a single XSS bug becomes full account takeover via token exfiltration. httpOnly cookies are invisible to JavaScript entirely — an XSS bug still lets an attacker act as the user *while the page is open*, but it can no longer steal a portable, replayable token. The cost of this choice is CSRF exposure, which is mitigated explicitly, not ignored (§5). `SameSite=Lax` (not `Strict`) is chosen so that following a shared board link right after login still works.
- Cookie names: `mk_at` (access, path `/`), `mk_rt` (refresh, path scoped to `/api/v1/auth/refresh` only, to minimize where it's ever sent).
- `POST /auth/refresh` validates + rotates `mk_rt` and reissues both cookies. The frontend's fetch layer retries a request once after a `401` by calling refresh, then redirects to `/login` if that also fails.
- `POST /auth/logout` performs **real server-side revocation** (marks the refresh token row revoked) and clears both cookies — a copied cookie doesn't stay valid until natural expiry.

---

## 2. Database Schema Design (Prisma)

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  ownedBoards   Board[]        @relation("BoardOwner")
  boardMembers  BoardMember[]
  refreshTokens RefreshToken[]
  auditLogs     AuditLog[]
}

model RefreshToken {
  id                String    @id @default(uuid())
  tokenHash         String    @unique
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt         DateTime
  revokedAt         DateTime?
  replacedByTokenId String?
  createdAt         DateTime  @default(now())

  @@index([userId])
}

model Board {
  id          String   @id @default(uuid())
  title       String
  description String?
  ownerId     String
  owner       User     @relation("BoardOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members BoardMember[]
  columns Column[]

  @@index([ownerId])
}

enum BoardRole {
  OWNER
  EDITOR
  VIEWER
}

model BoardMember {
  id        String    @id @default(uuid())
  boardId   String
  board     Board     @relation(fields: [boardId], references: [id], onDelete: Cascade)
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      BoardRole
  createdAt DateTime  @default(now())

  @@unique([boardId, userId])
  @@index([userId])
}

model Column {
  id        String   @id @default(uuid())
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  title     String
  rank      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tasks Task[]

  @@index([boardId, rank])
}

model Task {
  id          String   @id @default(uuid())
  columnId    String
  column      Column   @relation(fields: [columnId], references: [id], onDelete: Cascade)
  boardId     String   // denormalized: fast board-scoped authz, and the natural future shard key (§7)
  title       String
  description String?
  rank        String
  version     Int      @default(0) // optimistic concurrency token, see §3
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([columnId, rank])
  @@index([boardId])
}

model AuditLog {
  id         String   @id @default(uuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action     String   // e.g. "BOARD_SHARE", "MEMBER_REMOVE", "ROLE_CHANGE"
  entityType String
  entityId   String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
}
```

`Task.boardId` is deliberately denormalized. It costs one extra column kept in sync inside the same transaction as any column change, but it means authorization checks on a task never need a `Task → Column → Board` join, and it's the exact column a future sharding strategy would partition on (§7).

### Ordering strategy: fractional rank keys, not integer positions

Rejected approach: an integer `position` column renumbered on every move — that means rewriting every row between the old and new position on every drag, which is slower and creates real lock-contention risk when two users reorder the same column at once.

**Chosen approach — LexoRank-style string ranks:**

- Each `Task`/`Column` has `rank: String`, drawn from a lexicographically ordered keyspace (base-36/base-62 style strings).
- **Insert between rank A and rank B**: compute the lexicographic midpoint string (pad the shorter string, walk character by character, insert a middle character when they're adjacent). This touches only the one moved row — no other row in the column is rewritten. **Insert at start**: midpoint of `""` and the first rank. **Insert at end**: midpoint of the last rank and a fixed max sentinel.
- **Rebalancing**: repeated insertions at the same boundary can make a rank string grow long over time. When a rank exceeds a length threshold (e.g. 40 characters), a `rebalanceColumn(columnId)` utility re-spaces every task in *that column only* evenly across the keyspace — an O(n) operation, but scoped to one column and rare in practice, so it never blocks unrelated columns or boards. This utility is unit-tested independently of the move endpoint.
- The same scheme orders columns within a board.

### Pagination strategy

- **Boards list** (`GET /boards`) — **cursor-based**, on a composite `(createdAt, id)` cursor: `?cursor=<base64>&limit=20`, query shaped as `WHERE (createdAt, id) < (cursor.createdAt, cursor.id) ORDER BY createdAt DESC, id DESC LIMIT 20`. A user's board list (own + shared) grows without bound over time; offset pagination would need to scan-and-discard rows on every page and can skip/duplicate rows when boards are created or deleted between page fetches. Cursor pagination avoids both problems and stays O(limit) at any depth.
- **Columns per board** — loaded in full as part of `GET /boards/:id`. Not paginated: a Kanban board has a small, bounded number of columns by definition, and splitting them across pages would break the UI's core assumption that all columns are visible together.
- **Tasks per column** — loaded in full for the MVP (realistic demo usage is tens of tasks per column, not thousands). The correct approach if columns grow unbounded — cursor pagination on `(rank, id)`, `GET /columns/:id/tasks?cursor=...` — is documented here as the deliberate next step, paired with the caching strategy in §7, rather than built now. This is a scope decision, not an oversight.

---

## 3. Task Movement API

**Endpoint:** `PATCH /api/v1/tasks/:id/move`

**Request:**

```json
{
  "targetColumnId": "uuid",
  "beforeTaskId": "uuid | null",
  "afterTaskId": "uuid | null",
  "expectedVersion": 4
}
```

The client sends the **neighbor task ids** it currently sees the dragged task between, not a raw numeric index. Indices go stale the instant another user's move lands; neighbor ids let the server re-derive the true midpoint from current state inside the transaction, and fall back to append-at-end (self-healing) if a referenced neighbor has since moved or been deleted. The same endpoint and payload shape handles both same-column reorder and cross-column move — `targetColumnId` equal to the current column is a reorder, different is a cross-column move.

**Response (200):**

```json
{
  "id": "uuid",
  "columnId": "uuid",
  "rank": "n5",
  "version": 5,
  "updatedAt": "2026-09-03T12:00:00.000Z"
}
```

**On conflict — `409 Conflict`:**

```json
{ "error": "VERSION_CONFLICT", "currentTask": { "...": "latest row" } }
```

The frontend reconciles from `currentTask` without a full board refetch.

### Concurrency control

Every `Task` carries `version: Int`. A move must include `expectedVersion`; the update is:

```sql
UPDATE "Task" SET rank = $1, "columnId" = $2, version = version + 1, "updatedAt" = now()
WHERE id = $3 AND version = $4
```

run inside `prisma.$transaction(..., { isolation: Serializable })`. A zero-row match means someone else moved it first — the service returns `409` with the fresh row. `SERIALIZABLE` isolation additionally protects against the subtler race where two concurrent moves both read the same neighbor pair and compute the *same* midpoint (which would collide); Postgres aborts one transaction with a serialization failure, the service retries the midpoint computation once against fresh state, then gives up with `409` if it still conflicts.

**Why optimistic concurrency over row locking (`SELECT ... FOR UPDATE`):** conflicts are rare (two people moving the *same* task at the *same* instant), and optimistic concurrency keeps the transaction short — no lock is held across the network round trip, just read-neighbors → compute midpoint → conditional write, all inside one quick transaction. This is deliberately **not** last-write-wins: silent data loss on a shared board is a real correctness bug, and "conflict-free" in the assessment brief is read here as "detected and resolved with the client shown the true state," not merely "doesn't crash."

**This is also what keeps users' work from conflicting with each other:** version-checked writes mean two users' concurrent moves are always resolved explicitly rather than clobbering each other, and every task lives inside exactly one board's authorization scope (§4) — so no user's drag-and-drop can ever touch another user's board in the first place, only the boards they were explicitly given access to.

### Real-time sync across connected clients

A `BoardGateway` (NestJS `@WebSocketGateway`, Socket.IO) authenticates the same JWT on connection; clients join a room named `board:<boardId>` when they open a board. After a move commits, `TasksService.move()` emits `task.moved` to that room with the updated task. The frontend reconciles: if the event matches its own in-flight optimistic update it's a no-op, otherwise it patches the query cache directly (§6).

This is scoped down for the 4-day build deliberately: a **single Nest instance**, in-memory Socket.IO rooms — correct for one backend container. A Redis Socket.IO adapter for cross-instance pub/sub is the documented next step once the API is horizontally scaled (§7). On (re)connect, the client simply refetches the full board via REST rather than replaying a missed-event log — simple and robust for MVP scope; an events table with monotonic per-board sequence numbers is the correct approach at scale (§7), not built now.

WebSockets were chosen over polling (strictly worse UX for equal or more effort) and over SSE (one-directional; would still need a separate mutation path, adding complexity without benefit here).

---

## 4. Authorization / Access Control

- **`JwtAuthGuard`** (global, via `APP_GUARD`, with a `@Public()` escape hatch for `/auth/register`, `/auth/login`, `/auth/refresh`) — validates `mk_at`, attaches `req.user`.
- **`BoardAccessGuard`** — resolves `boardId` (directly from the route, or via a lookup when the route only has a `columnId`/`taskId`), loads the caller's `BoardMember` row, and returns `403 Forbidden` if none exists. Attaches `req.boardRole` for downstream role checks. This one guard is reused uniformly across `BoardsController`, `ColumnsController`, and `TasksController`.
- **Board creation auto-inserts an `OWNER` `BoardMember` row** for the creator — `Board.ownerId` is not a second, separately-checked authority path. Every access check is one `BoardMember` lookup, with no special-cased "or are you the owner" branch to forget.
- **`RolesGuard` / `@RequireRole(BoardRole.EDITOR)`** layered on mutation routes — a `VIEWER` gets `403` on any non-GET board/column/task route. `POST /boards/:id/members` (sharing) is `OWNER`-only.
- **Cross-board access is structurally prevented**, not just checked per-method: every column/task endpoint resolves and authorizes the parent board *before* the service layer runs a single query, so there is no code path that can reach a task belonging to a board the caller was never granted access to (closing the classic IDOR gap where `PATCH /tasks/:id` trusts a bare id).
- Removing a member with role `OWNER` is rejected unless another `OWNER` exists on the board — a board can never end up ownerless.

---

## 5. Security Hardening

| Concern | Control |
|---|---|
| Password storage | bcrypt, cost factor 12 |
| Token theft blast radius | Short-lived (15 min) access JWT + rotating hashed refresh tokens with reuse-detection (whole token family revoked on reuse); tokens never logged |
| Brute force / credential stuffing | `@nestjs/throttler` — generous global default, tight limits (e.g. 5/min/IP) specifically on `/auth/login` and `/auth/register` |
| Mass assignment / bad input | `class-validator` DTOs on every controller + global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — unexpected fields (e.g. a client trying to sneak `ownerId` into an update body) are stripped, not silently accepted |
| Cross-origin requests | `app.enableCors({ origin: FRONTEND_URL, credentials: true })` — explicit allowlist, never `*` (also invalid with `credentials: true`) |
| Common HTTP header attacks | `helmet()` globally (CSP, `X-Content-Type-Options`, `X-Frame-Options`, etc.) |
| SQL injection | Prisma parameterizes every query by default — already safe by construction; the codebase never uses `$queryRawUnsafe` with interpolated input |
| XSS | React's default JSX escaping covers the app's actual surface (titles/descriptions are always rendered as plain text); `dangerouslySetInnerHTML` is never used anywhere board/column/task content is rendered |
| CSRF (cookie-based auth) | `SameSite=Lax` blocks classic cross-site form-POST CSRF; every mutating request additionally requires a custom header (e.g. `X-Requested-With`), which forces a CORS preflight — a page on a non-allowlisted origin fails that preflight before the request ever reaches the server |
| Secrets hygiene | `.env` git-ignored in both submodules; `.env.example` committed with placeholders documenting every required variable; `docker-compose.yml` reads secrets via `env_file:` from a root `.env` that is never committed |
| Accountability | `AuditLog` records access-control-sensitive actions only (board sharing/unsharing, role changes, member removal, board deletion) — not routine task moves, which would just be noise |

---

## 6. Frontend: A Lag-Free, Premium Drag-and-Drop UI

- **Library: `dnd-kit`**, not `react-beautiful-dnd`. `react-beautiful-dnd` (Atlassian) is in maintenance mode and has known friction under React 18 Strict Mode/concurrent rendering; `dnd-kit` is actively maintained, accessible by design, and its sensor architecture (`PointerSensor` + `KeyboardSensor`) supports both mouse/touch and keyboard drag from the same drag context.
- **Optimistic updates** on `onDragEnd`:
  1. Compute the new local ordering from where the card was dropped.
  2. Update the TanStack Query cache directly (`queryClient.setQueryData`) — the UI reflects the move instantly, no spinner, no wait.
  3. Fire `PATCH /tasks/:id/move` in the background, having captured the previous cache snapshot.
  4. On success, reconcile with the server's authoritative `rank`/`version` (usually a visual no-op).
  5. On failure (`409` or network error), roll back to the snapshot and surface a toast ("Someone else moved this task — board updated") — the standard TanStack Query `onMutate`/`onError`/`onSettled` optimistic pattern.
- **State management: TanStack Query only** for server state — board/column/task data *is* the app's state, kept fresh by REST responses and the WebSocket-driven cache patches from §3. No Redux/Zustand needed at this scope. Local-only UI state (which modal is open, in-progress drag visuals) stays in component state, deliberately kept separate.
- **Avoiding re-render storms mid-drag:** board data is structured so each `Column` subscribes to its own slice of the cache rather than the whole board re-rendering on every drag frame; `TaskCard` is `React.memo`'d keyed on `id` + `rank`/`version`; `dnd-kit`'s `useSortable` drives the drag gesture itself via CSS transforms, not layout-affecting state, which is what keeps dragging smooth before the drop even commits. Virtualization (`@tanstack/react-virtual`) for very long columns is documented as the natural next step, not built by default since demo-sized boards don't need it.
- **Loading states:** skeleton placeholders shaped like real columns/cards (Tailwind `animate-pulse`) instead of a blank screen or spinner, driven by TanStack Query's `isLoading`.
- **Premium feel:** Framer Motion's `layout` prop on task cards for the "other cards glide to make room" reflow effect, paired with plain Tailwind transitions for hover/drag-lift shadow — JS-driven animation only where layout reflow actually needs it, CSS for everything else.
- **Accessibility:** `dnd-kit`'s `KeyboardSensor` gives keyboard users Tab to focus, Space/Enter to pick up, Arrow keys to move within/across columns, Space/Enter to drop, Escape to cancel — with customized `aria-live` announcements ("Task 'Fix login bug' moved to column 'In Progress', position 2 of 4") via `dnd-kit`'s `announcements` API, so screen-reader users get equivalent functionality, not just mouse users.

---

## 7. Scaling to Millions of Users — Documented Roadmap (not built in the 4-day MVP)

This section is explicit forward-looking reasoning, kept separate from the MVP. It shows where the MVP's deliberate simplifications would need to be revisited under real production load — none of it is implemented in the 4-day submission.

1. **Read replicas first.** Kanban board traffic is read-heavy (many views per write). Add streaming-replication read replicas; route `GET` reads to a replica pool and all writes (plus any read requiring strong consistency, like the move endpoint's neighbor-rank read) to the primary. This is the single highest-leverage step, since read volume scales with active users largely independent of write volume.
2. **Partition/shard by board.** Once a single primary can't absorb write volume, partition `Task`/`Column`/`AuditLog` by `boardId` — Postgres native declarative partitioning, or a Citus-distributed table with `boardId` as the distribution key. This is exactly why `Task.boardId` was denormalized in the MVP schema (§2): it's already the natural shard key with no join required to route a query, and a board's own data never needs a cross-shard transaction, since a task move only ever touches rows within one board.
3. **Redis caching** of hot/frequently-viewed boards (`board:<id>` → serialized board+columns+tasks), invalidated on the same `task.moved`/`column.updated` events the WebSocket gateway already emits — the cache-invalidation hook piggybacks on infrastructure that already exists. Redis also backs the Socket.IO adapter (`@socket.io/redis-adapter`) required the moment there's more than one API instance, since in-memory Socket.IO rooms (the MVP approach) don't span processes.
4. **PgBouncer** connection pooling in transaction-pooling mode, once dozens of horizontally-scaled Nest instances would otherwise each hold their own Prisma connection pool and exhaust Postgres's own connection ceiling long before query throughput becomes the bottleneck.
5. **BullMQ** (Redis-backed) background queue for non-critical/async writes — audit log persistence, share-invite emails, large-board WebSocket fan-out, analytics — moved off the synchronous request path so the move endpoint's latency stays bounded regardless of downstream side effects.
6. **Horizontal API scaling** — stateless NestJS instances behind a load balancer; REST needs no session affinity (JWT is stateless), Socket.IO needs either sticky sessions or the Redis adapter above.
7. **CDN** for Next.js static assets (JS bundles, fonts, images) — decouples static asset latency from the app server entirely.
8. **Indexing review at scale** — the MVP's `(boardId, rank)` / `(columnId, rank)` composite indexes remain correct, but at high cardinality add covering indexes (`INCLUDE`) so list reads are satisfied from the index alone, and periodically review `pg_stat_statements` for sequential scans as new query patterns (search/filter) emerge.
9. **Observability** — structured JSON logging (`nestjs-pino`) with request-id correlation, distributed tracing across Next.js → Nest → Postgres/Redis, and p50/p95/p99 metrics specifically on the move endpoint, since it's the highest-frequency, latency- and concurrency-sensitive path and the first place contention will show up.

---

## 8. Project Structure & 4-Day Delivery Plan

**Repository layout** (mapped onto the existing submodules):

```
mini-kanban/
├── README.md                 (setup steps + sample env vars)
├── docker-compose.yml        (db + backend + frontend)
├── ASSESSMENT_EN.md / ASSESSMENT_BN.md
├── PLAN_EN.md / PLAN_BN.md   (this document)
├── mini-kanban-backend/
│   ├── src/
│   │   ├── auth/            (controller, service, strategies, DTOs, guards)
│   │   ├── users/
│   │   ├── boards/
│   │   ├── columns/
│   │   ├── tasks/           (CRUD + move endpoint + rank utility)
│   │   ├── common/          (guards, decorators, filters, interceptors, PrismaModule)
│   │   ├── gateway/         (BoardGateway, WebSockets)
│   │   └── main.ts
│   ├── prisma/schema.prisma, prisma/migrations/
│   ├── Dockerfile
│   └── .env.example
└── mini-kanban-frontend/
    ├── app/                  (Next.js App Router: /login, /register, /boards, /boards/[id])
    ├── components/           (Board, Column, TaskCard, DnD wrappers)
    ├── lib/                  (API client, TanStack Query setup, socket client)
    ├── Dockerfile
    └── .env.example
```

**Docker Compose:** three services — `db` (`postgres:16-alpine`, named volume, healthcheck), `backend` (builds from `mini-kanban-backend/Dockerfile`, waits for `db` healthy, runs `prisma migrate deploy` then starts, env from root `.env`), `frontend` (builds from `mini-kanban-frontend/Dockerfile`, depends on `backend`, `NEXT_PUBLIC_API_URL` pointed at it). One `docker-compose up --build` produces a working stack — this directly satisfies the assessment's "preferable" Docker deliverable.

**Root README:** prerequisites (Docker, Node LTS), `git clone --recurse-submodules`, `docker-compose up --build` quick start, local (non-Docker) dev instructions per submodule, sample `.env` blocks for backend (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`) and frontend (`NEXT_PUBLIC_API_URL`), a short architecture-overview section pointing at this plan, and an optional live-deployment link placeholder.

**Day-by-day:**

- **Day 1 — Backend foundation.** `nest new` in `mini-kanban-backend`; Prisma schema (§2) + first migration; `PrismaModule`; `AuthModule` (register/login/refresh/logout, bcrypt, JWT strategies, cookie handling); global `ValidationPipe`/`helmet`/CORS/throttler wiring; `docker-compose.yml` with working `db` + `backend`. *Done when:* register/login/refresh/logout works end-to-end against Dockerized Postgres.
- **Day 2 — Domain CRUD, authorization, move API.** `BoardsModule`/`ColumnsModule`/`TasksModule` full CRUD; `BoardAccessGuard`/`RolesGuard`/`@RequireRole` (§4); board-sharing endpoints; the rank utility (midpoint + rebalance, unit-tested in isolation); `PATCH /tasks/:id/move` with optimistic concurrency (§3); `BoardGateway` emitting `task.moved`. *Done when:* the full API surface is testable via REST client, including a manual two-client concurrency test.
- **Day 3 — Frontend.** `create-next-app` in `mini-kanban-frontend`; Tailwind; auth pages wired to the cookie flow; boards list (cursor pagination); board detail page with columns+tasks; `dnd-kit` integration with optimistic updates (§6); TanStack Query + WebSocket reconciliation; skeleton states; keyboard DnD pass. *Done when:* a real drag-and-drop board works in the browser against the real backend.
- **Day 4 — Polish, hardening, delivery.** Framer Motion pass; empty/error states; audit-log wiring; security checklist pass against §5; full `docker-compose up --build` smoke test from a clean clone (zero manual steps beyond creating `.env`); finalize root README; optional deploy (e.g. Vercel for frontend + Railway/Render for backend+Postgres) if time remains.
