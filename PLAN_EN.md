# System Design & Implementation Plan — Mini Kanban Board

**Scope note:** the official assessment (see [ASSESSMENT_EN.md](ASSESSMENT_EN.md)) is a 4-day take-home on a single-instance PostgreSQL stack. It does not ask for sharding or million-user SLAs. This plan is written in layers on purpose:

- **Sections 1–6, 9** describe what is actually **built for the 4-day submission** — a correct, secure, well-architected MVP on the prescribed stack.
- **Section 7** is a **documented roadmap**, not code to write now — it explains how the same data model evolves toward very large scale (millions of users), so the design decisions made in the MVP (see the callouts) are shown to be compatible with that future, without over-engineering a take-home assessment.
- **Section 8** states, explicitly rather than by omission, which realistic Kanban-app failure modes are deliberately **out of scope** for the 4-day build and why.
- **Section 10** is the concrete QA checklist this plan is tested against.

This revision was written after checking the plan against a realistic list of failure modes a newly-built Kanban tool tends to hit in production (reshuffling, jump-back, duplicate/disappearing cards, race conditions, WebSocket ordering, deadlocks, permission leaks, cache stampedes, etc.). Each one is now either already mitigated by a decision below, newly mitigated (marked **(hardening)**), or explicitly scoped out (§8) — nothing is left silently unaddressed.

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
- **(hardening) The browser only ever talks to one origin.** `/api/v1/*` is proxied to Nest through `next.config.js` rewrites (the WebSocket upgrade rides the same origin). This is not cosmetic: `SameSite=Lax` cookies are **not sent on cross-site requests**, so a split deployment — frontend on Vercel, API on Railway, two different registrable domains — would silently break login entirely on the deployed demo while working perfectly on `localhost`. Proxying keeps the cookies first-party, keeps `SameSite=Lax` intact, and removes the need for cross-origin credentialed CORS in production altogether. `enableCors` stays configured for local development, where the two dev servers do sit on different ports. The alternative (`SameSite=None; Secure`) is rejected: it would re-open exactly the CSRF surface §5 works to close.

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
  boardId    String?  // denormalized, not a FK — survives board deletion so the audit trail isn't lost, and is the column §7's board-based partitioning actually shards on; nullable so non-board security events (e.g. refresh-token reuse detection, §1) can also be audited
  action     String   // e.g. "BOARD_SHARE", "MEMBER_REMOVE", "ROLE_CHANGE"
  entityType String
  entityId   String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
  @@index([boardId, createdAt])
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

- **Boards list** (`GET /boards`) — **cursor-based**, on a composite `(createdAt, id)` cursor: `?cursor=<base64>&limit=20`, query shaped as `WHERE (createdAt, id) < (cursor.createdAt, cursor.id) ORDER BY createdAt DESC, id DESC LIMIT 20`. A user's board list (own + shared) grows without bound over time; offset pagination would need to scan-and-discard rows on every page and can skip/duplicate rows when boards are created or deleted between page fetches. Cursor pagination avoids both problems. **Caveat:** because access is determined via `BoardMember` (§4) rather than `Board.ownerId`, this is actually a join — `BoardMember.userId = ?` filtered by its index, then joined to `Board` for the `(createdAt, id)` sort — so it's index-driven on the filter side but not fully index-covered end-to-end the way a single-table cursor would be. That's a non-issue at MVP data volumes (a user's board count is small enough to sort in memory) but is called out here rather than overclaiming pure O(limit) at unbounded scale; §7 notes it as one of the things to revisit if per-user board counts ever grow large.
- **Columns per board** — loaded in full as part of `GET /boards/:id`. Not paginated: a Kanban board has a small, bounded number of columns by definition, and splitting them across pages would break the UI's core assumption that all columns are visible together.
- **Tasks per column** — loaded in full for the MVP (realistic demo usage is tens of tasks per column, not thousands). The correct approach if columns grow unbounded — cursor pagination on `(rank, id)`, `GET /columns/:id/tasks?cursor=...` — is documented here as the deliberate next step, paired with the caching strategy in §7, rather than built now. This is a scope decision, not an oversight.

**(hardening) Column counts are derived, not stored.** The task count shown in a column header (e.g. "In Progress (15)") is always computed client-side from the length of the loaded task array — there is no separate `taskCount` field on `Column` to keep in sync. This structurally avoids counter-drift bugs (stale cache, missed events, soft-delete edge cases) for the MVP. The moment tasks-per-column pagination is added (§7), this stops being free and needs a real answer — a DB-maintained count column updated in the same transaction as any insert/delete, not a value derived from a partial page.

**(hardening) A task cannot move between boards.** `Task.boardId` only ever changes as a side effect of a validated move within the same board (see the cross-board rejection rule in §3) — there is no operation that reassigns a task to a different board's `boardId` independently of its `columnId`. This closes the classic "one field updated, the other one forgotten" consistency bug before it can exist.

---

## 3. API Surface & Task Movement

### Full endpoint list

Every route below `/api/v1`. "Role" is the minimum `BoardMember` role required (§4); `EDITOR+` means `EDITOR` or `OWNER`.

| Method | Route | Role | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | |
| POST | `/auth/login` | public | sets `mk_at` + `mk_rt` |
| POST | `/auth/refresh` | cookie | rotates the refresh token |
| POST | `/auth/logout` | auth | real server-side revocation |
| GET | `/auth/me` | auth | current user, for the app shell |
| GET | `/boards` | auth | cursor-paginated; boards the user is a member of |
| POST | `/boards` | auth | creator auto-inserted as `OWNER` member |
| GET | `/boards/:id` | member | board + columns + tasks; **every task includes its `version`** (the move API is unusable without it) |
| PATCH | `/boards/:id` | EDITOR+ | rename / describe |
| DELETE | `/boards/:id` | OWNER | cascades columns → tasks |
| GET | `/boards/:id/members` | member | |
| POST | `/boards/:id/members` | OWNER | share with a registered user by email + role |
| PATCH | `/boards/:id/members/:userId` | OWNER | role change |
| DELETE | `/boards/:id/members/:userId` | OWNER | last-owner guard (§4) |
| POST | `/boards/:id/columns` | EDITOR+ | appended at end via the rank utility |
| PATCH | `/columns/:id` | EDITOR+ | rename |
| DELETE | `/columns/:id` | EDITOR+ | cascades its tasks |
| PATCH | `/columns/:id/move` | EDITOR+ | **column reordering** — same rank utility, same neighbor-id payload shape as task move |
| POST | `/columns/:id/tasks` | EDITOR+ | appended at end |
| PATCH | `/tasks/:id` | EDITOR+ | title / description |
| DELETE | `/tasks/:id` | EDITOR+ | |
| PATCH | `/tasks/:id/move` | EDITOR+ | the move endpoint, below |

### The move endpoint

**Endpoint:** `PATCH /api/v1/tasks/:id/move`

**Request:**

```json
{
  "targetColumnId": "uuid",
  "beforeTaskId": "uuid | null",
  "afterTaskId": "uuid | null",
  "position": 2,
  "expectedVersion": 4
}
```

The UI sends the **neighbor task ids** it currently sees the dragged task between, not a raw numeric index. Indices go stale the instant another user's move lands; neighbor ids let the server re-derive the true midpoint from current state inside the transaction, and fall back to append-at-end (self-healing) if a referenced neighbor has since moved or been deleted.

**`position` is also accepted, deliberately.** The brief asks for "moving a task across different columns **to a specific position index**", so the endpoint honours that contract literally: if `position` is supplied (and neighbor ids are not), the server resolves it to the neighbor pair *inside the same transaction* — `SELECT id, rank FROM "Task" WHERE "columnId" = $1 ORDER BY rank, id OFFSET max(position-1,0) LIMIT 2` — and then follows the identical rank-midpoint path. So an index-based caller gets exactly the same race-safe behaviour as the UI; the index is resolved against live server state rather than the client's possibly-stale snapshot. When both are supplied, neighbor ids win (they carry more information). Out-of-range indices clamp to start/end rather than erroring.

The same endpoint and payload shape handles both same-column reorder and cross-column move — `targetColumnId` equal to the current column is a reorder, different is a cross-column move. `PATCH /columns/:id/move` mirrors it exactly for column ordering.

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

### Cross-board move validation (hardening)

Before computing any rank, the service resolves `targetColumnId` → its `boardId` and checks it equals the task's own `boardId` (already established by `BoardAccessGuard`, §4). If they differ, the request fails with `400 Bad Request` (`INVALID_TARGET_COLUMN`) rather than silently reassigning the task to a foreign board. The assessment's own wording only describes moving a task *between columns*, never between boards, so this endpoint structurally cannot do the latter — it's not just unimplemented, it's actively rejected. This also closes a subtler authorization gap: without this check, an `EDITOR` on board A could target a `columnId` belonging to board B and move a task there, even without any access to board B.

### Concurrency control

Every `Task` carries `version: Int`. A move must include `expectedVersion`; the update is:

```sql
UPDATE "Task" SET rank = $1, "columnId" = $2, version = version + 1, "updatedAt" = now()
WHERE id = $3 AND version = $4
```

run inside `prisma.$transaction(..., { isolation: Serializable })`. A zero-row match means someone else moved it first — the service returns `409` with the fresh row. `SERIALIZABLE` isolation additionally protects against the subtler race where two concurrent moves both read the same neighbor pair and compute the *same* midpoint (which would collide); Postgres aborts one transaction with a serialization failure, the service retries the midpoint computation once against fresh state, then gives up with `409` if it still conflicts.

**If two ranks ever did collide, nothing user-visible breaks.** Both the server (`ORDER BY rank, id`) and the client (§6) break ties on `id`, so a duplicate rank still produces one stable, deterministic order for everyone. A `@@unique([columnId, rank])` constraint is therefore *deliberately not* added: it would convert a rare, harmless collision into a user-facing `500` on a drag. The uniqueness of ranks is an optimisation, not a correctness requirement — which is the right way round.

**Why optimistic concurrency over row locking (`SELECT ... FOR UPDATE`):** conflicts are rare (two people moving the *same* task at the *same* instant), and optimistic concurrency keeps the transaction short — no lock is held across the network round trip, just read-neighbors → compute midpoint → conditional write, all inside one quick transaction. This is deliberately **not** last-write-wins: silent data loss on a shared board is a real correctness bug, and "conflict-free" in the assessment brief is read here as "detected and resolved with the client shown the true state," not merely "doesn't crash."

**This is also what keeps users' work from conflicting with each other:** version-checked writes mean two users' concurrent moves are always resolved explicitly rather than clobbering each other, and every task lives inside exactly one board's authorization scope (§4) — so no user's drag-and-drop can ever touch another user's board in the first place, only the boards they were explicitly given access to.

### Deadlock avoidance (hardening)

Two concurrent moves can never deadlock each other, by construction: a move takes no explicit row locks (`SELECT ... FOR UPDATE` is never used) and only ever writes one row — the dragged task itself — via a single conditional `UPDATE ... WHERE id = ? AND version = ?`. Reading the neighbor tasks' current ranks to compute a midpoint is a plain MVCC snapshot read, not a lock. So two transactions racing on the same column never hold two locks in opposing order and wait on each other — the classic deadlock shape. The one failure mode that *can* happen — `SERIALIZABLE` rejecting a transaction because its computed midpoint would collide with a concurrent one — is a single-transaction abort, not a deadlock, and is already handled by the one-time retry described above.

### Out-of-order response and event protection (hardening)

Rapid dragging (a user moving the same task two or three times in quick succession) can make network responses — and WebSocket `task.moved` events — arrive out of send order. Both the REST response path and the WebSocket path are guarded by the same rule: **never apply anything older than what's already applied.** Concretely:
- Every outgoing move request is tagged with a per-task, monotonically increasing client-side sequence number. If a response for an older sequence number arrives after a newer one has already been applied, it's discarded.
- Every `task.moved` WebSocket event carries the task's server-assigned `version`. The client compares it to the version already in its cache for that task id and ignores the event if it isn't strictly newer — closing the exact "Event 2 then Event 1 arrives, UI shows the Event-1 result" failure mode.
- Because the server itself is the source of truth for `version` and `rank` (not the client's guess), this reduces to a simple last-highest-version-wins rule on the client, with the server's optimistic-concurrency check (above) as the actual authority on what really happened.

### Real-time sync across connected clients

A `BoardGateway` (NestJS `@WebSocketGateway`, Socket.IO) authenticates the same JWT on connection; clients join a room named `board:<boardId>` when they open a board. **(hardening)** Joining that room is itself authorized, not just the connection: the `join` handler re-runs the same `BoardMember` check as `BoardAccessGuard` (§4) before admitting the socket to the room, and rejects with a socket error otherwise — a valid JWT alone is not enough to listen to a board's events, closing the "WebSocket channel not validated" leak where a user could otherwise receive live updates for a board they have no access to. After a move commits, `TasksService.move()` emits `task.moved` to that room with the updated task. The frontend reconciles: if the event matches its own in-flight optimistic update it's a no-op, otherwise it patches the query cache directly (§6), subject to the version-gating rule above.

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
- **(hardening)** This same `BoardMember` check is not REST-only: the WebSocket gateway's room-join handler (§3) re-runs it before admitting a socket to a board's live-update channel, so there is no lower-security side door into a board's data via WebSockets.

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
- **(hardening) `cancelQueries` before every optimistic patch.** `onMutate` first calls `queryClient.cancelQueries({ queryKey: ['board', boardId] })` before writing the optimistic state. Without this, an in-flight background refetch (e.g. a stale request from before the drag, or React Query's own refetch-on-focus) can land *after* the optimistic write and silently overwrite it with pre-drag data — this is the concrete mechanism behind "card jumps back even though the move actually succeeded."
- **(hardening) Every cache write is a keyed upsert, never a wholesale replace.** Moving a task, applying a `task.moved` WebSocket event, and reconciling a mutation response all go through one function that updates a single task by `id` inside the existing cached structure. The board's full state is only ever replaced wholesale by the initial `GET /boards/:id` (or an explicit reconnect resync, §3) — never by a move response or event. This is what prevents both **duplicate cards** (a WS event or retried request would otherwise be appended instead of moved) and **disappearing cards** (a partial/incomplete response would otherwise blank out tasks it didn't mention).
- **(hardening) Stable identity and a single sort key.** React keys are always `task.id`, never array index. The rendered order of a column's tasks is always `Array.sort` by the `rank` string (with `id` as a tiebreak) and nothing else — no separate client-side reordering logic exists that could disagree with the server's rank, which is the usual root cause of "drag one card, unrelated cards reshuffle."
- **(hardening) Per-task request sequencing.** Each outgoing move mutation is tagged with a locally incrementing sequence number per task id (§3); an older response arriving after a newer one has already landed is dropped rather than applied, so rapidly dragging the same card two or three times in a row can't leave it in a stale position because of response reordering.
- **(hardening) Optimistic create swaps a temp id, never appends twice.** Creating a task inserts a placeholder card carrying a client-generated `tempId` and a `pending` flag; when the server responds, that row is **replaced in place** (temp id → real id), not appended. Without this explicit swap, the keyed-upsert rule above would treat the server's real id as a brand-new task and the card would appear twice — the same duplicate bug, arriving through the create path instead of the move path. An inbound `task.created` WebSocket event matching a still-pending temp row is de-duplicated the same way.
- **UX: drag ergonomics.** `dnd-kit`'s auto-scroll is enabled so dragging toward an edge scrolls the board horizontally (and the column vertically) instead of trapping the card at the viewport boundary; a persistent drop placeholder — a dashed gap the exact height of the dragged card — shows where it will land rather than making the user infer it; and **every column is registered as a droppable container in its own right**, not merely as a list of sortable items, so dropping into an *empty* column works. That last one is the single most common dnd-kit Kanban bug: with only item-level drop targets, an empty column has nothing to hit and the card silently snaps back.
- **UX: undo on move.** The post-move toast offers **Undo** for ~5 seconds, implemented as one symmetric call to the same endpoint with the previous neighbor ids — cheap, since the client already captured that snapshot for rollback. Mis-drops are the most common Kanban user error, so this is the highest-value premium touch available for the effort. Deletes get a confirm dialog instead of undo — resurrecting a row under a new id would churn ids and complicate the cache rules above for little gain.
- **State management: TanStack Query only** for server state — board/column/task data *is* the app's state, kept fresh by REST responses and the WebSocket-driven cache patches from §3. No Redux/Zustand needed at this scope. Local-only UI state (which modal is open, in-progress drag visuals) stays in component state, deliberately kept separate.
- **Avoiding re-render storms mid-drag:** board data is structured so each `Column` subscribes to its own slice of the cache rather than the whole board re-rendering on every drag frame; `TaskCard` is `React.memo`'d keyed on `id` + `rank`/`version`; `dnd-kit`'s `useSortable` drives the drag gesture itself via CSS transforms, not layout-affecting state, which is what keeps dragging smooth before the drop even commits. Virtualization (`@tanstack/react-virtual`) for very long columns is documented as the natural next step, not built by default since demo-sized boards don't need it.
- **Loading states:** skeleton placeholders shaped like real columns/cards (Tailwind `animate-pulse`) instead of a blank screen or spinner, driven by TanStack Query's `isLoading`.
- **Premium feel:** Framer Motion's `layout` prop on task cards for the "other cards glide to make room" reflow effect, paired with plain Tailwind transitions for hover/drag-lift shadow — JS-driven animation only where layout reflow actually needs it, CSS for everything else.
- **Accessibility:** `dnd-kit`'s `KeyboardSensor` gives keyboard users Tab to focus, Space/Enter to pick up, Arrow keys to move within/across columns, Space/Enter to drop, Escape to cancel — with customized `aria-live` announcements ("Task 'Fix login bug' moved to column 'In Progress', position 2 of 4") via `dnd-kit`'s `announcements` API, so screen-reader users get equivalent functionality, not just mouse users.
- **(hardening) Mobile/touch drag.** `dnd-kit`'s `PointerSensor` (and `TouchSensor` where finer control is needed) is configured with an activation constraint — a short delay (~150–250ms) and small movement tolerance (~5px) — before a touch is treated as a drag rather than a scroll gesture, so tapping and vertically scrolling a column don't accidentally start a drag. The board's horizontal column-to-column scrolling is its own dedicated scroll container, kept separate from the vertical per-column touch-drag zones, so a horizontal swipe to see more columns doesn't fight with picking up a card.
- **(design) The visual direction is "Filing Room"**, approved 2026-09-04 and specified in [`mini-kanban-frontend/DESIGN.md`](mini-kanban-frontend/DESIGN.md) with a working mockup at `mini-kanban-frontend/design/filing-room.reference.html`. That document is the source of truth for tokens, type, component anatomy and motion; it does not change any decision above. Two implementation details in it *refine* this section, both for reasons written out there: (a) the `PointerSensor` is split into `MouseSensor { distance: 4 }` + `TouchSensor { delay: 200, tolerance: 5 }` — the delay is needed to keep touch scrolling from registering as a drag, but the same delay on a mouse reads as lag rather than polish; (b) Framer Motion's `layout` prop is **not** used on sortable cards — it fights `useSortable`'s own transform and produces judder plus an off-by-a-few-pixels landing, so the reflow is driven by dnd-kit's transition (280ms) and Framer Motion is kept for card enter/exit, modals and toasts. The "cards glide to make room" effect is unchanged; only which library drives it is.

---

## 7. Scaling to Millions of Users — Documented Roadmap (not built in the 4-day MVP)

This section is explicit forward-looking reasoning, kept separate from the MVP. It shows where the MVP's deliberate simplifications would need to be revisited under real production load — none of it is implemented in the 4-day submission.

1. **Read replicas first.** Kanban board traffic is read-heavy (many views per write). Add streaming-replication read replicas; route `GET` reads to a replica pool and all writes (plus any read requiring strong consistency, like the move endpoint's neighbor-rank read) to the primary. This is the single highest-leverage step, since read volume scales with active users largely independent of write volume.
2. **Partition/shard by board.** Once a single primary can't absorb write volume, partition `Task`/`Column`/`AuditLog` by `boardId` — Postgres native declarative partitioning, or a Citus-distributed table with `boardId` as the distribution key. This is exactly why `Task.boardId` was denormalized in the MVP schema (§2): it's already the natural shard key with no join required to route a query, and a board's own data never needs a cross-shard transaction, since a task move only ever touches rows within one board.
3. **Redis caching** of hot/frequently-viewed boards (`board:<id>` → serialized board+columns+tasks), invalidated on the same `task.moved`/`column.updated` events the WebSocket gateway already emits — the cache-invalidation hook piggybacks on infrastructure that already exists. **Cache-stampede protection**: a single-flight lock per cache key (e.g. a short-lived Redis `SETNX` mutex) ensures that when a hot board's cache entry expires under heavy concurrent read load, only one request repopulates it while the rest wait on or briefly serve the stale value (stale-while-revalidate), rather than all of them hitting Postgres at once; jittered TTLs spread expiry across popular boards so they don't all miss the cache in the same instant. Redis also backs the Socket.IO adapter (`@socket.io/redis-adapter`) required the moment there's more than one API instance, since in-memory Socket.IO rooms (the MVP approach) don't span processes.
4. **PgBouncer** connection pooling in transaction-pooling mode, once dozens of horizontally-scaled Nest instances would otherwise each hold their own Prisma connection pool and exhaust Postgres's own connection ceiling long before query throughput becomes the bottleneck.
5. **BullMQ** (Redis-backed) background queue for non-critical/async writes — audit log persistence, share-invite emails, large-board WebSocket fan-out, analytics — moved off the synchronous request path so the move endpoint's latency stays bounded regardless of downstream side effects.
6. **Horizontal API scaling** — stateless NestJS instances behind a load balancer; REST needs no session affinity (JWT is stateless), Socket.IO needs either sticky sessions or the Redis adapter above.
7. **CDN** for Next.js static assets (JS bundles, fonts, images) — decouples static asset latency from the app server entirely.
8. **Indexing review at scale** — the MVP's `(boardId, rank)` / `(columnId, rank)` composite indexes remain correct, but at high cardinality add covering indexes (`INCLUDE`) so list reads are satisfied from the index alone; revisit the boards-list join (§2's caveat) with a denormalized sortable field on `BoardMember` if per-user board counts ever grow large enough for the join-then-sort to matter; and periodically review `pg_stat_statements` for sequential scans as new query patterns (search/filter) emerge.
9. **Observability** — structured JSON logging (`nestjs-pino`) with request-id correlation, distributed tracing across Next.js → Nest → Postgres/Redis, and p50/p95/p99 metrics specifically on the move endpoint, since it's the highest-frequency, latency- and concurrency-sensitive path and the first place contention will show up.

---

## 8. Explicitly Out of Scope for the 4-Day MVP

Stated here deliberately, so nothing looks like an oversight: these are real Kanban-app concerns that this plan does **not** build in the 4-day submission, and why.

- **Search & filtering.** No search or filter feature is requested anywhere in the assessment. Consequently, neither search-index staleness nor "how do I compute a drop position relative to tasks hidden by an active filter" can arise — there's no filtered view to compute a position within.
- **Notifications** (push, email, in-app) and their duplicate-delivery risk. Not requested; the MVP has no notification system of any kind, so there is nothing that could fire twice.
- **Offline support / local-first sync.** A real feature (service worker, local write queue, offline↔online reconciliation) but with no basis in a 4-day single-repo assessment and orthogonal to the scaling roadmap in §7 — deferred entirely rather than half-built.
- **Tasks-per-column pagination.** Already scoped out in §2 for the MVP (full load per column); restated here for completeness alongside the other cuts.

---

## 9. Project Structure & 4-Day Delivery Plan

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

**(submission risk) Git submodules vs. "a single repository".** The brief asks for *one* GitHub repository **containing both frontend and backend directories**. Right now those two directories are **git submodules** pointing at separate repos — so a reviewer who runs a plain `git clone` (without `--recurse-submodules`, which most people do by reflex) gets two **empty folders** and a broken `docker-compose up`. That is the single highest-severity delivery risk in this plan, and it is a packaging problem, not a code problem. Resolve it before submission, preferred option first:

1. **De-submodule (recommended).** Remove the submodule entries and commit both projects as ordinary directories in this repo, so a plain clone is complete and matches the brief literally. Their separate repos can still exist for portfolio purposes; the submission just shouldn't depend on them.
2. **Keep submodules only if there's a reason to.** Then the README's *first* command must be `git clone --recurse-submodules …`, with `git submodule update --init --recursive` given as the recovery step, and a live deployment link becomes materially more important as independent proof the thing runs.

**Docker Compose:** three services — `db` (`postgres:16-alpine`, named volume, healthcheck), `backend` (builds from `mini-kanban-backend/Dockerfile`, waits for `db` healthy, runs `prisma migrate deploy` then starts, env from root `.env`), `frontend` (builds from `mini-kanban-frontend/Dockerfile`, depends on `backend`, `NEXT_PUBLIC_API_URL` pointed at it). One `docker-compose up --build` produces a working stack — this directly satisfies the assessment's "preferable" Docker deliverable.

**Root README:** prerequisites (Docker, Node LTS), `git clone --recurse-submodules`, `docker-compose up --build` quick start, local (non-Docker) dev instructions per submodule, sample `.env` blocks for backend (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`) and frontend (`NEXT_PUBLIC_API_URL`), a short architecture-overview section pointing at this plan, and an optional live-deployment link placeholder.

**Day-by-day:**

- **Day 1 — Backend foundation.** `nest new` in `mini-kanban-backend`; Prisma schema (§2) + first migration; `PrismaModule`; `AuthModule` (register/login/refresh/logout, bcrypt, JWT strategies, cookie handling); global `ValidationPipe`/`helmet`/CORS/throttler wiring; `docker-compose.yml` with working `db` + `backend`. *Done when:* register/login/refresh/logout works end-to-end against Dockerized Postgres.
- **Day 2 — Domain CRUD, authorization, move API.** `BoardsModule`/`ColumnsModule`/`TasksModule` full CRUD; `BoardAccessGuard`/`RolesGuard`/`@RequireRole` (§4); board-sharing endpoints; the rank utility (midpoint + rebalance, unit-tested in isolation); `PATCH /tasks/:id/move` with optimistic concurrency, cross-board rejection, and deadlock-free design (§3); `BoardGateway` emitting `task.moved` with join-time authorization. *Done when:* the full API surface is testable via REST client, including the concurrency/IDOR/cross-board test cases in §10.
- **Day 3 — Frontend.** `create-next-app` in `mini-kanban-frontend`; Tailwind; auth pages wired to the cookie flow; boards list (cursor pagination); board detail page with columns+tasks; `dnd-kit` integration with optimistic updates (§6); TanStack Query + WebSocket reconciliation; skeleton states; keyboard DnD pass. *Done when:* a real drag-and-drop board works in the browser against the real backend.
- **Day 4 — Polish, hardening, delivery.** Framer Motion pass; empty/error states; audit-log wiring; security checklist pass against §5; the full §10 QA checklist run end-to-end; resolve the submodule packaging decision above; full `docker-compose up --build` smoke test from a clean clone (zero manual steps beyond creating `.env`); finalize root README; optional deploy (e.g. Vercel for the frontend + Railway/Render for backend+Postgres, with the API reached through the Next.js rewrite from §1 so cookies stay first-party) if time remains.

**Automated tests — kept deliberately small.** Not a full test suite; just the handful whose failure would actually be embarrassing in review, and all of them cheap:

- Unit: the rank utility — midpoint between two ranks, insert-at-start, insert-at-end, and a rebalance that preserves relative order. This is pure logic with no I/O, so it's fast and worth testing properly.
- Integration (Jest + `supertest`, one test each): register→login→refresh→logout; an IDOR attempt returning `403`; a move with a stale `expectedVersion` returning `409`; a cross-board `targetColumnId` returning `400`.

Four integration tests plus one unit file is roughly an afternoon, and it covers exactly the four claims in this document that a reviewer is most likely to actually probe.

**If the schedule slips, cut in this order** (decided now, so the decision isn't made at 2am on day 4):

1. Framer Motion polish → fall back to plain Tailwind transitions. Visual only.
2. WebSocket live sync → the board still works fully; other users' changes just need a refresh. (§3's version-gating then goes unused but harmless.)
3. Audit logging → the authorization rules it records are still *enforced*; only the record-keeping is lost.
4. Keyboard drag-and-drop → regrettable, but mouse DnD still satisfies the brief.

**Never cut:** the `409` conflict path, the authorization guards, and the one-command Docker bring-up. Those are the parts the assessment actually grades.

---

## 10. Testing & QA Checklist

A prioritized, actually-runnable-in-4-days set of test cases, aimed at the failure modes real Kanban tools tend to ship with:

**Drag-and-drop correctness**
- Drag one card and confirm no unrelated card's `rank` or position changes (guards against reshuffle bugs, §6).
- Rapid-drag the same card three times in a row; confirm it ends up exactly where the last drop placed it, not an intermediate position (§3/§6 out-of-order protection).
- Force a failed move (e.g. stop the backend mid-drag) and confirm the card rolls back to its pre-drag position with a visible toast, not a silent stuck state (§6).
- Drop a card into a completely **empty column** and confirm it lands there (the classic dnd-kit droppable-container gap, §6).
- Drag a card toward the edge of the viewport and confirm the board auto-scrolls instead of trapping it (§6).
- Create a task on a throttled connection and confirm exactly **one** card exists once the server responds — not a pending duplicate (temp-id swap, §6).
- Call `PATCH /tasks/:id/move` with only `position` (no neighbor ids) and confirm it lands at that index — the brief's literal contract (§3).

**Concurrency**
- Two browser sessions (or two users) move the same task at the same moment; confirm one succeeds and the other gets a `409` with the corrected state, not a silently overwritten result (§3).
- Two users reorder different tasks in the same column simultaneously; confirm both moves land correctly with no lost update.

**Authorization**
- From a session with no membership on a board, call `PATCH /tasks/:id` directly (bypassing the UI) for a task on that board; confirm `403`/`404`, not success (IDOR check, §4).
- Attempt a move with a `targetColumnId` belonging to a different board than the task's own; confirm `400` (§3 cross-board rejection).
- Connect a WebSocket and attempt to join a `board:<boardId>` room for a board the user has no access to; confirm the join is rejected (§3/§4).

**Real-time sync**
- Open the same board in two tabs; move a card in one and confirm the other reflects it without a manual refresh.
- Kill and restore network on one tab mid-session; confirm it resyncs to the correct board state on reconnect rather than showing stale data indefinitely (§3).

**Security**
- Trip the `/auth/login` rate limit with repeated bad-password attempts; confirm it's throttled (§5).
- Confirm a logged-out session's refresh token is actually rejected server-side after `POST /auth/logout` (real revocation, §1).
- **On the deployed URL specifically** (not just localhost): log in, hard-refresh, and confirm the session persists — this is the check that catches a cross-site cookie misconfiguration, which `localhost` testing cannot reveal (§1).

**Accessibility**
- Complete a full move (pick up, move across columns, drop) using only the keyboard, and confirm the `aria-live` announcements describe it correctly (§6).
