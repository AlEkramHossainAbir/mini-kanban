# Root Roadmap — Orchestration, Packaging & Submission

The order in which the whole thing gets built, wired together, and handed in.
Per-project detail lives in [`mini-kanban-backend/ROADMAP.md`](mini-kanban-backend/ROADMAP.md) and [`mini-kanban-frontend/ROADMAP.md`](mini-kanban-frontend/ROADMAP.md); design rationale lives in [`PLAN_EN.md`](PLAN_EN.md) / [`PLAN_BN.md`](PLAN_BN.md).

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
    build: ./mini-kanban-frontend
    env_file: .env
    depends_on: [backend]
    ports: ["3000:3000"]

volumes:
  pgdata:
```

- [ ] `depends_on: condition: service_healthy` — not a bare `depends_on`, or the backend races Postgres and crash-loops
- [ ] Migrations run from the backend's container `CMD` (`prisma migrate deploy`), not by hand
- [ ] **Acceptance:** `git clone` → `cp .env.example .env` → `docker compose up --build` → working app at `:3000` with **zero** other manual steps

---

## Phase 4 — Root README (~45 min) · *Day 4*

The graded deliverable. Structure:

- [ ] One-paragraph description + screenshot/GIF of a drag in progress
- [ ] **Quick start** — the three commands from Phase 3's acceptance test, verbatim
- [ ] Local dev without Docker — per-project `npm install` / `npm run dev`, plus the standalone Postgres container command
- [ ] **Sample environment variables** — the full block from Phase 1, explicitly required by the brief
- [ ] API endpoint table (copy from PLAN §3)
- [ ] Architecture summary: the rank-key ordering, optimistic concurrency (`version` + `409`), role-based board access — 3 short paragraphs linking to `PLAN_EN.md` for depth
- [ ] Live demo link (if deployed) + test credentials
- [ ] What's intentionally out of scope, linking to PLAN §8 — this reads as judgment, not as gaps

---

## Phase 5 — Deployment sequence (~1.5 h) · *Day 4, optional but high value*

Order matters; each step needs the previous one's URL:

1. [ ] **Managed Postgres** (Railway/Render/Neon) → copy `DATABASE_URL`
2. [ ] **Backend** (Railway/Render) → set all env vars with **freshly generated** secrets, `NODE_ENV=production`; verify `/api/v1/health`
3. [ ] **Frontend** (Vercel) → root dir `mini-kanban-frontend`, `BACKEND_URL` = the API origin, `NEXT_PUBLIC_WS_URL` = the same
4. [ ] **Back to the backend** → set `FRONTEND_URL` to the Vercel domain, redeploy
5. [ ] Seed one demo account + a populated board so the reviewer sees a real board, not an empty state

- [ ] **The check that only production can reveal:** log in on the deployed URL, hard-refresh, confirm the session survives. If it doesn't, the same-origin proxy (PLAN §1) isn't working and cookies are being dropped cross-site.

---

## Phase 6 — Final submission checklist

Straight from the brief's *Submission & Deliverables*:

- [ ] **Single repository** containing both `mini-kanban-backend/` and `mini-kanban-frontend/` directories — verified by a fresh `git clone` (Phase 0)
- [ ] **`README.md`** with step-by-step local setup **and sample environment variables** (Phase 4)
- [ ] **`docker-compose.yml`** bringing up database + services with minimal setup (Phase 3)
- [ ] **Deployment link** (optional) with working demo credentials (Phase 5)

And against the *Core Requirements*:

- [ ] Registration + login with token-based auth
- [ ] Boards have an owner and can be shared with other registered users
- [ ] Users can only view/mutate boards, columns and tasks they have access to; cross-board access blocked
- [ ] Full CRUD on boards, columns and tasks
- [ ] Task Movement API handling **both** same-column reorder **and** cross-column move **to a specific position index**
- [ ] Ordering is stable, accurate and conflict-free under concurrent moves
- [ ] Interactive board view with working drag-and-drop
- [ ] Full **PLAN §10** QA checklist run end-to-end, including the two-tab concurrency test
- [ ] No secrets committed — `git log -p | grep -i secret` comes back clean
- [ ] `docker compose up --build` verified one final time from a **fresh clone in a clean directory**

---

## If you fall behind

Cut in this order (decided now, not at 2am on day 4):

1. Framer Motion polish → plain Tailwind transitions
2. WebSocket live sync → the board still works, others' changes just need a refresh
3. Audit logging → the rules it records are still *enforced*
4. Keyboard drag-and-drop

**Never cut:** the `409` conflict path, the authorization guards, or the one-command Docker bring-up. Those are what the assessment actually grades.
