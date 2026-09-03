---
name: docker-bringup
description: Verify the one-command Docker Compose bring-up from a genuinely fresh clone — the acceptance test ROADMAP.md Phase 3/6 and the submission checklist both require. Use when asked to verify docker-compose works, test the fresh-clone flow, or confirm the app is ready to submit/deploy.
---

# Fresh-clone Docker bring-up verification

Root `ROADMAP.md` states this explicitly: *"verify with an actual fresh clone, not by
assumption."* A `docker compose up` that only ever ran against a working directory with
leftover `node_modules`, a stale `.env`, or manually-run migrations proves nothing about what a
reviewer's `git clone` will actually do. This skill runs the real thing.

## Preconditions

- `git status` in the main repo must be clean (or the user has confirmed uncommitted changes
  are intentionally excluded from this test) — this test clones from committed history only.
- Root `.gitignore`, `.env.example`, and `docker-compose.yml` must exist (root ROADMAP.md Phases
  1 and 3). If any is missing, stop and say which phase is unfinished — don't fake the test.

## Procedure

1. Clone into the scratchpad, never inside the working repo:
   `git clone <absolute path to this repo> <scratchpad>/fresh-mini-kanban`
2. `cd` into the clone and confirm both `mini-kanban-backend/` and `mini-kanban-frontend/` have
   real files, not empty directories (this is also the Phase 0 submodule regression check from
   root ROADMAP.md — a reviewer must never get two empty folders).
3. `cp .env.example .env` — no manual edits. The point is minimal setup, per the brief.
4. `docker compose up --build -d` from the fresh clone.
5. Poll `docker compose ps` until all services report healthy/running, with a sane timeout
   (Postgres + two builds can take a few minutes on a cold Docker cache — don't declare failure
   prematurely, but don't wait forever either).
6. Verify, in order (this order matters — it's the dependency chain):
   - `db` healthcheck passes before `backend` starts at all (`depends_on: condition:
     service_healthy`, not a bare `depends_on`) — check container start timestamps/logs if
     unsure, don't just assume compose ordering is correct.
   - Migrations ran automatically inside the backend container's `CMD` (check backend logs for
     `prisma migrate deploy` output) — not something this script or the user ran by hand.
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/health` returns `200`.
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000` returns `200`.
7. `docker compose logs` — skim for unexpected errors/crash-loops even if the health checks above
   passed (a service can restart-loop and still show "healthy" briefly).
8. Tear down: `docker compose down` in the fresh clone, then delete the scratch clone directory —
   always, whether the test passed or failed.

## Report

State plainly which of steps 6a–6d passed or failed, with the actual command output — not just
"it worked." If anything failed, name the ROADMAP.md phase responsible (e.g. "Phase 3's
`depends_on: condition: service_healthy` is missing from docker-compose.yml") rather than just
describing the symptom. This is one of the two acceptance gates in root ROADMAP.md Phase 6 (final
submission checklist) — treat a fail here as blocking, not cosmetic.
