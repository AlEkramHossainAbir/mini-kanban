---
name: qa-checklist
description: Run the Mini Kanban QA checklist from PLAN_EN.md §10 against a running instance of the app — drag-and-drop correctness, concurrency, authorization, realtime sync, security, and accessibility. Use when the user asks to QA the board, run the test checklist, verify the move API is conflict-free, or check the app before submission/deployment.
---

# Mini Kanban QA checklist

Runs the full test matrix from `PLAN_EN.md` §10 ("Testing & QA Checklist") against a live
instance (local Docker Compose stack, or a deployed URL). This is a manual/exploratory pass plus
scripted checks where the API allows it — not a substitute for the automated tests in backend
ROADMAP.md Phase 11, which should already be green before running this.

## Before starting

1. Confirm the target: local (`docker compose up` already running, `localhost:3000`/`:4000`) or a
   deployed URL. Ask the user if it's ambiguous.
2. Confirm there's at least one board with 2+ columns and several tasks, and at least two
   registered user accounts (one board owner, one invited member) — several checks below need
   two distinct sessions/tabs. Create fixtures via the API or UI if they don't exist yet.
3. Read `PLAN_EN.md` §3 (task movement / rank ordering) and §4 (authorization) once before
   starting — the checklist below assumes that context.

## Checklist — work through each item, report pass/fail with evidence

**Drag-and-drop correctness**
- [ ] Drag one card; confirm no *other* card's `rank`/position changed (inspect via `GET
      /boards/:id` before/after, not just visually).
- [ ] Rapid-drag the same card 3x in quick succession; it must land exactly where the *last* drop
      placed it.
- [ ] Kill the backend mid-drag (or throttle/disconnect); the card must roll back to its pre-drag
      position with a visible toast — not a silently stuck optimistic state.
- [ ] Drop a card into a genuinely **empty column**; it must land there (classic dnd-kit
      droppable-container gap bug).
- [ ] Drag toward the viewport edge; the board must auto-scroll.
- [ ] Create a task on a throttled connection (devtools network throttling); confirm **exactly
      one** card exists once the server responds, not a duplicate pending card.
- [ ] `PATCH /tasks/:id/move` with only `{ "position": N }` (no `beforeTaskId`/`afterTaskId`)
      lands the task at that index — the brief's literal contract.

**Concurrency**
- [ ] Two sessions move the *same* task at the same moment (two tabs, or two curl/REST-client
      calls fired near-simultaneously with the same stale `expectedVersion`); exactly one gets
      `200`, the other gets `409` with the corrected row — not a silent overwrite.
- [ ] Two sessions reorder *different* tasks in the same column simultaneously; both land
      correctly, no lost update.

**Authorization**
- [ ] From a session with no membership on a board, call `PATCH /tasks/:id` directly for a task
      on that board (bypass the UI — use curl/REST client with that session's cookies); expect
      `403`/`404`, never success. This is the core IDOR check.
- [ ] Move a task with `targetColumnId` belonging to a *different* board than the task's own;
      expect `400`.
- [ ] Open a WebSocket and attempt to `join` a `board:<id>` room for a board the connecting user
      has no access to; the join must be rejected.

**Real-time sync**
- [ ] Same board open in two tabs; move a card in one, confirm the other updates without a manual
      refresh.
- [ ] Kill network on one tab mid-session, restore it; confirm it resyncs to correct state on
      reconnect (full refetch), not stale data indefinitely.

**Security**
- [ ] Trip the `/auth/login` rate limit with repeated bad-password attempts; confirm throttling
      kicks in (expect `429` after the configured limit).
- [ ] Log out, then attempt to use the old refresh token directly (replay the cookie value);
      confirm the server rejects it — real revocation, not just cookie-clearing.
- [ ] **On the deployed URL only** (skip locally — this can't be observed on `localhost`): log
      in, hard-refresh, confirm the session survives. A failure here means the same-origin proxy
      isn't working and `SameSite=Lax` cookies are being dropped cross-site.

**Accessibility**
- [ ] Complete a full move (pick up → move across columns → drop) using only the keyboard;
      confirm `aria-live` announcements correctly name the task, column, and position.

## Reporting

For every item: pass, fail (with repro steps and the actual vs. expected response/behavior), or
blocked (with what's missing — e.g. "no second test account exists yet"). Don't mark an item pass
based on the UI looking right alone when the checklist calls for inspecting the API response
directly (concurrency and authorization items especially). Group failures by the PLAN_EN.md §
they map to, since that's where the fix belongs.
