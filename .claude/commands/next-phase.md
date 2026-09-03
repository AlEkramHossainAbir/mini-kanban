---
description: Implement the next unchecked step in the build order from the three ROADMAP.md files
---

Follow root [ROADMAP.md](ROADMAP.md) Phase 2's build order — backend phases 0–4 before any
frontend work starts, backend 5–9 before frontend continues past its own Phase 2, etc. Never begin
a frontend phase whose endpoint isn't already returning correct JSON from a REST client.
(All paths below are relative to the repo root.)

Steps:

1. Determine current state the way `/phase-status` does — don't trust checkboxes blindly, verify
   against the repo.
2. Identify the single next phase to work on, in the correct backend/frontend interleaving, from
   [mini-kanban-backend/ROADMAP.md](mini-kanban-backend/ROADMAP.md) or
   [mini-kanban-frontend/ROADMAP.md](mini-kanban-frontend/ROADMAP.md).
3. Read the matching `§` section(s) of [PLAN_EN.md](PLAN_EN.md) referenced by that phase before
   writing any code — the design decisions are already made there.
4. Implement that phase's items only — don't sprawl into later phases.
5. Verify against that phase's own "Done when" / checklist criteria (run the server, hit the
   endpoint, run the test — whatever the phase specifies) before checking anything off.
6. Check off the completed items in the relevant ROADMAP.md file(s).
7. Summarize what changed and what the next phase will be. **Do not commit or push** — leave
   changes for the user to review and commit themselves.

If a phase's instructions conflict with something already built, stop and flag the conflict
instead of guessing.
