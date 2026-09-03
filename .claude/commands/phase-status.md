---
description: Report build progress across all three ROADMAP.md files without changing anything
---

Read [ROADMAP.md](ROADMAP.md), [mini-kanban-backend/ROADMAP.md](mini-kanban-backend/ROADMAP.md),
and [mini-kanban-frontend/ROADMAP.md](mini-kanban-frontend/ROADMAP.md) (paths are relative to the
repo root).

Cross-check each file's checkboxes against the actual state of the repo (files present, `git log`,
`package.json` deps actually installed, whether Docker/Prisma/auth/etc. really exist) rather than
trusting a checkbox blindly — a box may be unchecked even though the work is done, or vice versa.

Report, concisely:

1. Which phase each of the three roadmaps is actually on right now.
2. The single next actionable step (cite the exact phase and file).
3. Anything checked off in the file that doesn't match reality, or vice versa — flag it, don't
   silently fix the checkbox.

Do not start implementing anything — this command only reports status.
