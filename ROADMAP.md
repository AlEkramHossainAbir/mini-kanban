# Root Roadmap — Orchestration, Packaging & Submission

The order in which the whole thing gets built, wired together, and handed in.
Per-project detail lives in [`mini-kanban-backend/ROADMAP.md`](mini-kanban-backend/ROADMAP.md) and [`mini-kanban-frontend/ROADMAP.md`](mini-kanban-frontend/ROADMAP.md); design rationale lives in [`PLAN_EN.md`](PLAN_EN.md).

---

## Phase 0 — Fix the packaging **before writing any code** (~30 min)

The brief asks for *"a single GitHub repository containing both frontend and backend directories."*
Right now both are **git submodules**, so a reviewer running a plain `git clone` gets two **empty folders** and a dead `docker-compose up`.

Doing this on day 0 rather than day 4 also saves you four days of the submodule two-step (commit inner repo → push → update pointer → commit outer repo) on *every single change*.

```bash
cd /Users/ekram/project-repos/mini-kanban
cp -r mini-kanban-backend mini-kanban-frontend ~/kanban-backup   # safety net first

# push each submodule's current state to its own remote if you want to keep those repos alive, then:
for m in mini-kanban-backend mini-kanban-frontend; do
  git submodule deinit -f "$m"
  git rm --cached "$m"              # drops the gitlink, keeps the files
  rm -rf ".git/modules/$m"
  rm -rf "$m/.git"                  # de-link the inner repo
done

rm .gitmodules
git add .gitmodules mini-kanban-backend mini-kanban-frontend
git commit -m "chore: vendor frontend and backend as directories in the single submission repo"
```

- [x] `git clone <url> fresh && ls fresh/mini-kanban-backend` shows real files — verify with an actual fresh clone, not by assumption

> Keeping submodules is defensible only if you have a reason. If you do: the README's **first**
> command must be `git clone --recurse-submodules …`, with `git submodule update --init --recursive`
> as the recovery step, and a live deployment link becomes near-mandatory as proof it runs.

---

## Phase 1 — Root scaffolding (~20 min)

- [x] Root `.gitignore` — `.env`, `node_modules`, `.next`, `dist`
- [x] Root `.env.example` (committed) and `.env` (never committed):

```bash
POSTGRES_USER=kanban
POSTGRES_PASSWORD=kanban
POSTGRES_DB=kanban
DATABASE_URL=postgresql://kanban:kanban@db:5432/kanban?schema=public
JWT_ACCESS_SECRET=generate-with-openssl-rand-base64-32
JWT_REFRESH_SECRET=generate-a-different-one
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://backend:4000
NEXT_PUBLIC_WS_URL=http://localhost:4000
```

Note `BACKEND_URL` uses the compose **service name** (`backend`), while `NEXT_PUBLIC_WS_URL` uses `localhost` — the first is resolved server-side inside the Docker network, the second by the user's browser.

---

## Phase 2 — Build order (Days 1–3)

Backend and frontend are not independent — build in this sequence so each side always has something real to talk to:

| Day | Backend | Frontend |
|---|---|---|
| **1** | Phases 0–4: scaffold → deps → Prisma → app wiring → **auth** | — |
| **2** | Phases 5–9: guards → boards → columns → **tasks + move API** → gateway | — |
| **3** | (bug-fixing as the UI exercises the API) | Phases 0–10: scaffold → proxy → auth → boards → board view → **DnD** → optimistic → realtime |
| **4** | Phases 10–11: audit log, tests | Phase 11: polish, a11y, mobile |

Rule of thumb: **never start the frontend phase until its endpoint returns correct JSON in a REST client.** Debugging a broken UI against a broken API costs double.

---

## Phase 3 — docker-compose (~1 h) · *end of Day 1 for `db` + `backend`, completed Day 4*

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [pgdata:/var/lib/postgresql/data]
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: ./mini-kanban-backend
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
    ports: ["4000:4000"]

  frontend:
    # BACKEND_URL must arrive as a BUILD ARG, not only through env_file — Next bakes
    # the /api/v1 rewrite destination into routes-manifest.json at build time and
    # never re-reads it at run time (verified in frontend ROADMAP Phase 2). Without
    # this, the image bakes http://localhost:4000 and every API call in the
    # container 502s.
    build:
      context: ./mini-kanban-frontend
      args:
        BACKEND_URL: ${BACKEND_URL}
    env_file: .env
    depends_on: [backend]
    ports: ["3000:3000"]

volumes:
  pgdata:
```

- [x] `depends_on: condition: service_healthy` — not a bare `depends_on`, or the backend races Postgres and crash-loops. Verified via container start timestamps: `db` started at `17:16:46`, reached `healthy`, and only then did `backend` start at `17:17:49` — over a minute later, not racing.
- [x] Migrations run from the backend's container `CMD` (`prisma migrate deploy`), not by hand. Verified in `docker logs`: `Prisma schema loaded... 1 migration found... No pending migrations to apply` — the container's own `CMD` ran it, nothing was run by hand.
- [x] **Acceptance, working-tree pass:** `cp .env.example .env` → `docker compose up --build` on the current tree (not yet a `git clone`, since a real fix landed mid-verification — see below) → backend `GET /api/v1/health` → `200`; frontend `GET /` → `307` (the app's own documented unauthenticated-redirect behavior, frontend ROADMAP Phase 4 — not a docker-compose defect), serving real HTML from the Next standalone server. Host ports were remapped for this run only (`4002`/`3002`, via an uncommitted local override file, never touching `docker-compose.yml`) because this machine already had a dev Postgres on `5432` and dev servers on `3000`/`4000` running outside Docker; internal container-to-container networking (the actual thing being tested) was unaffected. **Still needed:** a literal fresh `git clone` run once the fix below is committed, since this pass exercised the working tree, not a clone.
- [x] **One real bug found and fixed**: `docker-compose.yml`'s `backend` and `frontend` services shared one `env_file: .env`, and root `.env.example`'s `PORT=4000` is the *backend's* var (backend ROADMAP Phase 13) — but Next's standalone server also honours `process.env.PORT`, so the frontend container silently listened on `4000` too. Container port `3000` had nothing on it, so the `3000:3000` mapping was dead (`curl` to it failed outright). Caught live via `docker logs` showing the frontend's own startup banner reading `Local: http://<host>:4000` instead of `:3000`. Fixed with an explicit `environment: { PORT: 3000 }` on the `frontend` service — a service-level `environment:` entry wins over `env_file`. Re-verified after the fix: the same banner now correctly reads `:3000`, and `curl` to the mapped host port succeeds. **This fix is written to `docker-compose.yml` but not yet committed** — the file's base version (`d915acd`) predates it.

---

## Phase 4 — Root README (~45 min) · *Day 4*

The graded deliverable. Structure:

- [x] One-paragraph description + screenshot/GIF of a drag in progress — `docs/board-drag.png`,
      captured live against the running dev stack (Playwright: registered a demo user, seeded a
      real board/columns/tasks via the API, mid-drag screenshot of the tilted `DragOverlay` card),
      not a mockup
- [x] **Quick start** — the three commands from Phase 3's acceptance test, verbatim
- [x] Local dev without Docker — per-project `npm install` / `npm run dev`, plus the standalone Postgres container command
- [x] **Sample environment variables** — the full block from Phase 1, explicitly required by the brief
- [x] API endpoint table (copy from PLAN §3)
- [x] Architecture summary: the rank-key ordering, optimistic concurrency (`version` + `409`), role-based board access — 3 short paragraphs linking to `PLAN_EN.md` for depth
- [x] Live demo link (if deployed) + test credentials — not deployed yet; states so plainly and links to Phase 5 rather than fabricating a link
- [x] What's intentionally out of scope, linking to PLAN §8 — this reads as judgment, not as gaps

---

## Phase 5 — Deployment sequence (~1.5 h) · *Day 4, optional but high value*

Order matters; each step needs the previous one's URL:

1. [x] **Managed Postgres** (Railway/Render/Neon) → copy `DATABASE_URL` — Railway Postgres,
       provisioned via `railway add --database postgres`; `DATABASE_URL` wired into the backend
       service as a Railway variable reference (`${{Postgres.DATABASE_URL}}`), never copy-pasted
       as a literal
2. [x] **Backend** (Railway/Render) → set all env vars with **freshly generated** secrets, `NODE_ENV=production`; verify `/api/v1/health` — deployed to Railway from `mini-kanban-backend/`
       (`railway up --path-as-root --service backend`, using the committed Dockerfile, Phase 12's
       three-stage build). `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` generated fresh via `openssl
       rand -base64 32` (two different values), `NODE_ENV=production`, `ACCESS_TOKEN_TTL=15m`,
       `REFRESH_TOKEN_TTL=7d`. Live at `https://backend-production-2621.up.railway.app`; `GET
       /api/v1/health` → `200 {"status":"ok"}` with the full helmet header set, confirmed via
       `curl` against the public domain. Logs confirm `prisma migrate deploy` applied the one
       committed migration against a genuinely fresh database and Nest mapped all 22 routes with
       zero startup errors.
3. [x] **Frontend** (Vercel) → root dir `mini-kanban-frontend`, `BACKEND_URL` = the API origin, `NEXT_PUBLIC_WS_URL` = the same — deployed via `vercel link` + `vercel deploy --prod` from
       `mini-kanban-frontend/`, both vars set as Vercel Production environment variables pointing
       at the Railway backend origin above (confirmed baked into `routes-manifest.json` at build
       time, per frontend ROADMAP Phase 2/12's finding). Live at
       `https://mini-kanban-frontend-seven.vercel.app`.
4. [x] **Back to the backend** → set `FRONTEND_URL` to the Vercel domain, redeploy — `railway
       variable set FRONTEND_URL=https://mini-kanban-frontend-seven.vercel.app --service backend`
       triggered an automatic redeploy; logs confirm the app restarted clean with all routes
       remapped.
5. [x] Seed one demo account + a populated board so the reviewer sees a real board, not an empty
       state — `demo@example.com` / `DemoPass123!`, seeded live through the deployed frontend's
       own proxy (not a direct-to-backend call) via `curl` with a cookie jar: one board ("Product
       Launch"), 4 columns (Backlog/In Progress/Blocked/Done), 8 tasks distributed across them.
       The two auto-seeded default columns (`BoardsService`'s `DEFAULT_COLUMN_TITLES`, empty)
       were deleted afterward so the board reads cleanly rather than showing two "Done" columns.
       That curl-against-the-live-deployment approach was one-off and left nothing behind for a
       fresh local database — reported live 2026-09-05 as "demo credentials don't work locally".
       Fixed with `mini-kanban-backend/prisma/seed.ts` (idempotent upsert, `npm run db:seed`,
       README-documented in both the Docker and no-Docker quick starts) so the same
       `demo@example.com` / `DemoPass123!` login works against any database, local or deployed.
       That file's presence also silently broke `nest build`'s output layout — TypeScript's
       inferred `rootDir` widened from `src` to the project root once a second `.ts` file existed
       outside `src/`, so `dist/main.js` moved to `dist/src/main.js` and the container's
       `node dist/main.js` `CMD` stopped booting. Fixed by excluding `prisma/` in
       `tsconfig.build.json`, alongside the existing `prisma.config.ts` exclude. Re-verified after
       the fix: `docker compose build backend` → boots clean, `db:seed` run inside the container,
       full login → `/auth/me` → `/boards` chain checked through the frontend's own proxy exactly
       as this phase's own check requires.

- [x] **The check that only production can reveal:** log in on the deployed URL, hard-refresh, confirm the session survives. If it doesn't, the same-origin proxy (PLAN §1) isn't working and cookies are being dropped cross-site. — Verified via `curl` with a cookie jar against the live
      Vercel URL: `POST /api/v1/auth/login` through the frontend's proxy set `mk_at`/`mk_rt` as
      `HttpOnly; Secure; SameSite=Lax`, scoped to the Vercel origin; a **separate** subsequent
      `GET /api/v1/auth/me` request (simulating a hard refresh — a fresh request presenting only
      the stored cookies, no session state carried over) returned `200` with the correct user,
      proving the session survives across the split Vercel↔Railway deployment.

---

## Phase 6 — Final submission checklist

Straight from the brief's *Submission & Deliverables*:

- [x] **Single repository** containing both `mini-kanban-backend/` and `mini-kanban-frontend/` directories — verified by a fresh `git clone` (Phase 0), re-verified 2026-09-04 via the `docker-bringup` skill: a genuine `git clone` into a scratch directory shows real files in both, not empty submodule folders
- [x] **`README.md`** with step-by-step local setup **and sample environment variables** (Phase 4) — read in full 2026-09-04; quick start, no-Docker path, full env var block, API table, architecture summary and out-of-scope section are all present (the "stale, submodule-era README" note elsewhere in this repo's memory predates the actual rewrite — confirmed against the file itself, not the note)
- [x] **`docker-compose.yml`** bringing up database + services with minimal setup (Phase 3) — re-verified 2026-09-04 end to end: fresh clone → `cp .env.example .env` → `docker compose up --build` (host ports remapped in the scratch copy only, since this machine's own dev servers hold 3000/4000/5432 — internal service-name networking, the thing actually under test, was untouched) → `db` healthy before `backend` started (6s gap, not a race) → `prisma migrate deploy` ran from the backend's own `CMD` against a genuinely empty database → `GET /api/v1/health` → `200`, `GET /login` → `200`, zero restarts, zero errors in `docker compose logs`. Torn down and images removed after.
- [x] **Deployment link** (optional) with working demo credentials (Phase 5) — live at
      `https://mini-kanban-frontend-seven.vercel.app` (backend:
      `https://backend-production-2621.up.railway.app`), demo login `demo@example.com` /
      `DemoPass123!`, seeded with one populated board. See Phase 5 and the root README's "Live
      demo" section.

And against the *Core Requirements*, all re-verified live 2026-09-04 (via the `qa-checklist` skill, against the local dev stack, two real registered accounts, evidence inspected via the API response — not by UI appearance alone):

- [x] Registration + login with token-based auth — plus the `/auth/login` 5/min throttle actually tripped (`429` with `Retry-After`) and a post-logout refresh-token replay was rejected `401 "Session revoked"` (real server-side revocation, not just cookie-clearing)
- [x] Boards have an owner and can be shared with other registered users — share-by-email to a second account verified live
- [x] Users can only view/mutate boards, columns and tasks they have access to; cross-board access blocked — a no-membership session got `403` on `PATCH /tasks/:id`, `PATCH /tasks/:id/move` and `GET /boards/:id` alike (and the task's title was confirmed unchanged afterwards); a `targetColumnId` on a different board got `400 INVALID_TARGET_COLUMN`; a WebSocket `join` for a board the connecting user has no membership on got `{error:"FORBIDDEN"}`, and a bogus/replayed ws-ticket got rejected at the handshake itself
- [x] Full CRUD on boards, columns and tasks — exercised as fixtures for the checks above
- [x] Task Movement API handling **both** same-column reorder **and** cross-column move **to a specific position index** — a `{"position":0}` payload with no neighbour ids landed the task first, and every sibling's `rank`/`version` was byte-for-byte unchanged
- [x] Ordering is stable, accurate and conflict-free under concurrent moves — 5 concurrent `PATCH .../move` calls at the *same* task with the same stale `expectedVersion` produced exactly one `200` and four `409`s, `version` incremented exactly once; concurrent moves of *different* tasks in the same column both landed with no lost update
- [x] Interactive board view with working drag-and-drop — live in a real Chromium browser (Playwright): same-column drag reorders with no blank/duplicated titles; a drop into a genuinely empty column lands there; dragging toward the viewport edge auto-scrolls (`scrollLeft` 0→722 while holding near the edge); a task created under throttled network conditions ends up as exactly one card, never two; 3 rapid re-drags of the same card settle on exactly one instance of it; intercepting the move request to simulate a dead backend rolls the card back to its exact pre-drag order and surfaces the `"Couldn't move that card"` toast; zero browser console errors throughout
- [x] Full **PLAN §10** QA checklist run end-to-end, including the two-tab concurrency test — two isolated browser contexts (owner + an invited EDITOR), a task created in one appears in the other with no reload; keyboard-only lift/move/drop drives the `aria-live` region to read `Card "Task 2" moved to Backlog, position 2 of 4.`; a WS reconnect after a CDP-forced offline period leaves the "live" indicator correct and the board still rendering real data (the transient "reconnecting…" state itself stayed as hard to force live via CDP as frontend ROADMAP Phase 10 already documented — not re-litigated here)
- [x] No secrets committed — `git log -p --all | grep -i secret` and a scan for the JWT/Postgres env var patterns across all history come back with only the documented placeholders (`kanban:kanban`, `replace-with-32+-random-bytes`); `.env` was never committed and stays gitignored
- [x] `docker compose up --build` verified one final time from a **fresh clone in a clean directory** — same run as the `docker-compose.yml` box above

QA fixture data from this pass (2 throwaway accounts, 2 boards prefixed `QA …`) is still sitting in
the local dev Postgres — harmless, clearly labeled, left for the user to clear if they want a clean
dev DB before submission.

---

## If you fall behind

Cut in this order (decided now, not at 2am on day 4):

1. Framer Motion polish → plain Tailwind transitions
2. WebSocket live sync → the board still works, others' changes just need a refresh
3. Audit logging → the rules it records are still *enforced*
4. Keyboard drag-and-drop

**Never cut:** the `409` conflict path, the authorization guards, or the one-command Docker bring-up. Those are what the assessment actually grades.
