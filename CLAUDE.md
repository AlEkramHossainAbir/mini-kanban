# Mini Kanban Board — project memory

Full-stack take-home for **Webbriks** (4-day timeframe). A Kanban app: boards → columns → tasks,
with auth, board sharing/permissions, and drag-and-drop task movement as the graded core.

## Read these first, don't re-derive them

- [`ASSESSMENT_EN.md`](ASSESSMENT_EN.md) — the brief, verbatim requirements
- [`PLAN_EN.md`](PLAN_EN.md) — the system design: schema (§2), task-movement API & rank-string
  ordering (§3), authz (§4), security (§5), frontend DnD architecture (§6), explicit
  non-goals (§8), QA checklist (§10)
- [`ROADMAP.md`](ROADMAP.md) — root build order across both apps, docker-compose, deployment
- [`mini-kanban-backend/ROADMAP.md`](mini-kanban-backend/ROADMAP.md) — backend phase-by-phase plan
- [`mini-kanban-frontend/ROADMAP.md`](mini-kanban-frontend/ROADMAP.md) — frontend phase-by-phase plan
- [`mini-kanban-frontend/DESIGN.md`](mini-kanban-frontend/DESIGN.md) — **the "Filing Room" design
  system**: tokens (§2), type (§3), component anatomy (§4), motion (§5), the dnd-kit smoothness
  contract (§6), a11y (§7), the lightweight budget (§8), and the UI "Done when" list (§9). Read it
  before writing any board UI; `mini-kanban-frontend/design/filing-room.reference.html` is the
  approved look-and-feel mockup — open it in a browser, but **do not port its hand-rolled drag
  engine**, which exists only because an artifact cannot install `dnd-kit`

When implementing anything, find the relevant phase in the appropriate ROADMAP.md and the
matching `§` section in PLAN_EN.md before writing code — the design decisions and their reasons
are already written down there. Don't relitigate them without a real reason.

## Current state

- Root repo is a **single repository with vendored directories** (Phase 0 of ROADMAP.md is
  done — no more git submodules, no `.gitmodules`).
- **All three ROADMAP.md files are fully checked off** — root 30/30, backend 70/70, frontend
  89/89. There is no "next phase" left to implement; new work is improvement, not build-out.
- `mini-kanban-backend/` — all 22 endpoints in PLAN §3's table, the WebSocket gateway, the audit
  log, the CSRF header guard, the Dockerfile, and deployment. **67 unit tests + 57 e2e tests**
  (the e2e suite needs a live Postgres and `DATABASE_URL`/`JWT_*` in the environment; it boots the
  real `AppModule` through the same `configureApp()` as `main.ts`).
- `mini-kanban-frontend/` — scaffold through column drag and realtime sync, all done, plus board
  sharing and member role management. **36 unit tests** under Vitest (`npm test`), scoped to the
  pure logic: `lib/rank.ts`, the cache transforms in `lib/tasks.ts`, and
  `components/board/neighbors.ts`. **The visual direction is settled**: "Filing Room" (walnut
  desk, angle-cut manila tabs, ruled index cards), chosen 2026-09-04 and specified in
  `mini-kanban-frontend/DESIGN.md`.
- Root `.gitignore`, `.env.example`, `docker-compose.yml` and `README.md` all exist and are
  current — the README carries the quick start, the env var block, the full API table, the
  architecture summary and the live demo links.
- `.github/workflows/ci.yml` runs three jobs: backend (lint/types/unit/e2e against a Postgres
  service container), frontend (lint/types/unit/build), and a docker job that does the real
  `cp .env.example .env && docker compose up --build` acceptance test, then proves login works
  *through the Next rewrite proxy* and that the CSRF guard rejects a headerless POST.
- **The live deployment drifts from `main` unless it is redeployed.** It is a git-push-triggered
  deploy (Railway backend, Vercel frontend) and has been behind before — the symptom to check for
  is `GET /boards/:id/members/candidates` returning 404, or `POST /auth/login` not setting the
  `mk_sess` cookie. Both mean the deployed build predates work that is already on `main`. The
  missing `mk_sess` specifically logs reviewers out after 15 idle minutes, because
  `middleware.ts` gates `/boards/*` on `mk_at || mk_sess` and `mk_at` lives only 15 minutes.
- **Env vars are validated at boot** (`src/common/env.validation.ts`, wired into
  `ConfigModule.forRoot`): a missing/duplicated JWT secret or a malformed TTL stops the process
  with a readable error. It stays lenient outside `NODE_ENV=production` on purpose, so root
  Phase 3's `cp .env.example .env && docker compose up` still works with placeholder secrets.

Before starting new work, check `git log --oneline` and the checkboxes in the three ROADMAP.md
files rather than assuming — they get checked off as work lands.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind — `mini-kanban-frontend/` |
| Backend | NestJS 10, TypeScript, Prisma 6 — `mini-kanban-backend/`, listens on **:4000** behind the `/api/v1` global prefix |
| Database | PostgreSQL 16 |
| Realtime | Socket.IO via `@nestjs/websockets`, single instance |
| DevOps | Docker Compose — `db`, `backend`, `frontend` |

## Non-negotiables

These are called out explicitly in ROADMAP.md and PLAN_EN.md — never soften them to save time:

- The `409` optimistic-concurrency conflict path on `PATCH /tasks/:id/move` (`version` check).
- The authorization guard chain (`JwtAuthGuard` → `BoardAccessGuard` → `RolesGuard`) on every
  board/column/task route — no route that touches board data skips it.
- One-command Docker bring-up: `docker compose up --build` from a fresh clone, zero manual steps.
- httpOnly cookie auth (never `localStorage` for tokens) and the same-origin Next.js rewrite
  proxy for `/api/v1/*` — required for `SameSite=Lax` cookies to survive a split deployment.
- `DESIGN.md` is the source of truth for the UI. Its exact hex values, sizes, durations and
  easings are not to be rounded off or swapped for Tailwind defaults, and **no new styling,
  icon or animation dependency** gets added beyond frontend ROADMAP Phase 1's list.
- Drag-and-drop is built on `dnd-kit` with the four explicit settings in `DESIGN.md` §6
  (`MeasuringStrategy.Always`, `closestCorners`, the mouse/touch sensor split, and no Framer
  Motion `layout` on sortable cards). None of them is a dnd-kit default; each one prevents a
  specific, reproducible drag bug.

If time runs out, cut in this order instead (see root ROADMAP.md "If you fall behind"): Framer
Motion polish → WebSocket live sync → audit logging → keyboard drag-and-drop.

## Workflow rules for this repo

- **Never commit or push without the user's explicit go-ahead in that turn.** They review and
  make commits themselves; leave changes staged/unstaged and say what's ready.
- Build backend and frontend in the sequence root ROADMAP.md Phase 2 lays out — a frontend phase
  doesn't start until its backend endpoint already returns correct JSON via a REST client.
- After implementing a roadmap phase, check its box in the relevant ROADMAP.md file.
- Prisma migrations are committed and replayed with `migrate deploy`; never `prisma db push` for
  anything meant to survive.
- `rank.util.ts` (backend Phase 7) is pure functions, unit-tested before it's wired into any
  endpoint.

## Claude Code tooling in this repo

- `/phase-status` — reports where all three roadmaps actually stand vs. what's in the repo;
  read-only, changes nothing.
- `/next-phase` — implements the next unchecked roadmap step in the correct build order, verifies
  it against that phase's own "Done when" criteria, checks the box.
- `qa-checklist` skill — runs the PLAN_EN.md §10 test matrix (DnD correctness, concurrency/409,
  IDOR, realtime, security, a11y) against a running instance.
- `docker-bringup` skill — the fresh-clone `docker compose up --build` acceptance test from root
  ROADMAP.md Phase 3/6.
- `.claude/settings.json` — shared permission allowlist for the routine commands of this build
  (npm, npx prisma, docker compose, read-only git, curl to localhost). `git commit`/`push` are
  deliberately gated so they are never auto-approved and commits stay under the user's control.
  Local approvals land in `.claude/settings.local.json`, which is gitignored and must stay out of
  the submission.

## Assessment docs in this repo

`ASSESSMENT_BN.md` / `PLAN_BN.md` are Bangla translations of the same content — English versions
are canonical for implementation decisions.
