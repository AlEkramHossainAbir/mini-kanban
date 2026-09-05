# Frontend Roadmap — Next.js + Tailwind + dnd-kit

Execution roadmap for the Mini Kanban frontend, from an empty folder to a deployed app.
Design decisions live in [`PLAN_EN.md`](../PLAN_EN.md) (`§` references point there) — this file is the *order of operations*.

**Target:** Node 20 LTS · Next 14 (App Router) · React 18 · TypeScript · Tailwind
**Serves:** `http://localhost:3000`, talking to the API at the **same origin** via `/api/v1/*`

> ### Design direction: **Filing Room** (approved 2026-09-04)
>
> Every visual, motion and drag-feel decision lives in [`DESIGN.md`](DESIGN.md), with a working
> look-and-feel mockup at [`design/filing-room.reference.html`](design/filing-room.reference.html).
> **Open the mockup and read `DESIGN.md` §5–§6 before starting Phase 6.** Phases below reference
> its sections by `DESIGN §n`; those references are requirements, not suggestions.
>
> Two things that doc corrects in this roadmap, both with reasons written out in `DESIGN.md` §6 —
> apply the corrected version: the **sensor split** (Phase 7) and **no Framer Motion `layout` prop
> on sortable cards** (Phase 11).

---

## Phase 0 — Scaffold (~15 min)

```bash
cd mini-kanban-frontend
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

> **Pin Next 14 / React 18 deliberately.** Next 15 pulls React 19, where `dnd-kit` and some
> animation libraries still hit peer-dependency friction. In a 4-day build you cannot afford
> dependency archaeology — the assessment asks for Next.js, not for the newest Next.js.

- [x] `npm run dev` serves the starter page on `:3000`
- [x] Delete the boilerplate hero markup in `src/app/page.tsx`

---

## Phase 1 — Dependencies (~10 min)

```bash
npm i @tanstack/react-query @tanstack/react-query-devtools \
      @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @dnd-kit/modifiers \
      framer-motion socket.io-client \
      react-hook-form zod @hookform/resolvers \
      sonner clsx tailwind-merge lucide-react
```

| Package | Why |
|---|---|
| `@tanstack/react-query` | the *only* server-state layer (PLAN §6) — no Redux/Zustand |
| `@dnd-kit/*` | drag-and-drop; actively maintained, keyboard-accessible (PLAN §6) |
| `framer-motion` | `layout` prop for the "cards glide to make room" reflow |
| `socket.io-client` | live board sync (PLAN §3) |
| `react-hook-form` + `zod` | auth form validation, mirroring the server DTOs |
| `sonner` | toasts — used for move-conflict and undo |

- [x] Installed — exactly the 15 packages above, nothing else. Verified with `npm run build`:
      compiles clean on Next 14.2.35 / React 18, `/` at 87.4 kB First Load JS (the Phase 11
      < 200KB budget starts with plenty of headroom).
- [x] **React 18 peer ranges checked**, since pinning React 18 is the whole reason Phase 0 refused
      Next 15: `framer-motion@13.2.0` (`^18 || ^19`), `sonner@2.0.8` (`^18 || ^19`),
      `lucide-react@1.40.0` (`^16.5.1 … ^19`), `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`
      (`>=16.8`), `@hookform/resolvers@5.9.1` (accepts `zod@^4`, installed `4.5.4`). `npm i`
      resolved with **zero `ERESOLVE` conflicts and no `--legacy-peer-deps`**.
- [x] Fonts are **Archivo + Courier Prime via `next/font/google`** (`DESIGN §3`) — not a `<link>`
      tag, not a third family. **Landed in Phase 3** with the rest of the token pass; the
      scaffold's `localFont` Geist pair and `src/app/fonts/` were deleted. Verified in the served
      CSS: `--font-archivo: '__Archivo_2aad3c', …` and `--font-courier: '__Courier_Prime_87c02c', …`
      with self-hosted `@font-face` rules — exactly two families, no `<link>` to Google.
- [x] **No further dependency** may be added for styling, icons or animation. The Filing Room look
      is CSS gradients and these packages only (`DESIGN §8`)

---

## Phase 2 — Config: the same-origin proxy (~30 min) · **do this before writing any fetch code**

`next.config.js`:

```js
/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone',                 // needed for the Docker image in Phase 12
  async rewrites() {
    return [{
      source: '/api/v1/:path*',
      destination: `${process.env.BACKEND_URL}/api/v1/:path*`,
    }];
  },
};
```

- [x] `next.config.mjs` — `output: 'standalone'` + the `/api/v1/:path*` rewrite. Kept as **`.mjs`**
      (the scaffold's format) rather than the snippet's `.js`, and exported in Next's **function
      form** — `process.env.NEXT_PHASE` is `undefined` when Next 14 loads the config (probed, not
      assumed), so the build phase is only reachable via the function argument.
- [x] `BACKEND_URL` is a **server-side** variable (`http://localhost:4000` locally, the service name `http://backend:4000` in Docker) — deliberately *not* `NEXT_PUBLIC_*`.
      Confirmed server-side: after a build with a sentinel value, **0 files** under `.next/static`
      contain it.
- [x] **⚠️ `BACKEND_URL` is baked at BUILD time, not read at run time** — verified, and it directly
      threatens root Phase 3's "zero manual steps" acceptance. Next serialises rewrite destinations
      into `.next/routes-manifest.json` during `next build`; the standalone server reads that
      manifest and never re-reads the variable. Proved by building with a sentinel
      `http://baked-at-build-time:9999`, then starting with `BACKEND_URL=http://localhost:4000`:
      the manifest kept the sentinel and `/api/v1/health` returned **500**.
      **→ Phase 12's Dockerfile must pass `BACKEND_URL` as a build `ARG`**, not via compose's
      run-time `env_file:`. `next.config.mjs` now prints a loud build-time warning when it is unset
      (a warning, not a throw, so the Phase 12 image can still build).
- [x] All app code calls **relative** paths: `fetch('/api/v1/boards', { credentials: 'include' })`
      — standing rule; no fetch code exists yet, and `src/lib/api.ts` (Phase 3) is where it starts.
- [x] **Verified end to end** against the real backend on `:4000`: `/api/v1/health` → `200
      {"status":"ok"}` through `:3000`; `/api/v1/boards` unauthenticated → **401 from Nest** (not a
      Next 404, proving the rewrite reaches the API); `/api/v2/health` → 404, so only the intended
      prefix is proxied. **The cookie test that is the whole point of this phase**: login through
      `:3000` returned `mk_at` (`Path=/`) and `mk_rt` (`Path=/api/v1/auth/refresh`), both
      `HttpOnly; SameSite=Lax`, scoped to the `:3000` origin — and `GET /auth/me` + `GET /boards`
      through the proxy then returned `200` with real data.

> **Why this matters (PLAN §1):** the browser must only ever see one origin. `SameSite=Lax` cookies
> are not sent cross-site, so pointing the browser straight at a Railway/Vercel-split API would work
> on localhost and silently break login in production. Proxying keeps cookies first-party.
> As a bonus, nothing about the API URL gets baked into the client bundle at build time.

- [x] Tailwind: set your palette + a `--radius` token in `tailwind.config.ts` now, so "premium" isn't a day-4 retrofit
      — **landed in Phase 3** as the full `DESIGN §2` colour/radius/shadow/easing set, in one pass.

---

## Phase 3 — Providers, tokens & primitives (~1.5 h) · *Day 3*

**Do the tokens first** — every later phase styles against them, and retro-fitting a palette across
a built board is how a design direction quietly turns into "close enough".

- [x] `src/app/globals.css` — Filing Room tokens verbatim (`DESIGN §2`), walnut `body` background,
      and the scaffold's `prefers-color-scheme` block **deleted**. Verified in the CSS the dev
      server actually serves: `--wood:#5E4736`, `--manila:#D7C097`, `--faint:#7C7365` (the AA-safe
      value, not the mockup's lighter grey) and `--ease-settle:cubic-bezier(.16,1.24,.4,1)` — exact,
      not rounded. Also added `DESIGN §7`'s focus rings (manila on wood, blue on paper) and `§5`
      rule 3's `prefers-reduced-motion` block.
- [x] `tailwind.config.ts` — the colour / radius / shadow / easing extensions from `DESIGN §2`,
      pointing at the CSS variables so each token has exactly one definition. Added the two font
      families and `§5`'s named durations (`hover`/`reflow`/`settle` = 200/280/340ms).
- [x] `src/app/layout.tsx` — `next/font/google` for Archivo + Courier Prime as CSS variables
      (`DESIGN §3`); scaffold Geist fonts deleted.
- [x] `src/app/providers.tsx` — `QueryClientProvider` (`staleTime: 30_000`), Devtools in dev,
      `<Toaster />` from sonner. The client is created in `useState`, not at module scope, so a
      server-side singleton can't leak one user's cache into another's. `retry` refined: never
      retry a <500 `ApiError` (401 is the interceptor's job; 403/404 won't change), and **never
      retry a mutation** — replaying a move after a `409` would fight PLAN §3's concurrency
      contract instead of surfacing it.
- [x] `src/lib/api.ts` — `fetch` wrapper: always `credentials: 'include'`, `X-Requested-With:
      mini-kanban` on every mutation (PLAN §5), typed `ApiError` carrying `status` + body, and an
      `isConflict` helper for the 409 path.
- [x] **401 interceptor** — refresh once, retry, else redirect to `/login?next=…`. The single
      shared in-flight promise is not just a de-dupe nicety: refresh tokens **rotate**, and the
      backend treats reuse of a revoked token as theft and kills the whole family, so a stampede
      would log the user out. Verified the endpoint it leans on: `POST /auth/refresh` through the
      proxy returned `200` and re-issued both `mk_at` and `mk_rt`.
- [x] `src/lib/types.ts` — `Board`, `Column`, `Task` (with `version`), `BoardRole`, `Paginated<T>`.
- [x] `src/components/ui/` — `Button` (§4.6's three exact variants), `Input`, `Modal`, `Skeleton` +
      `CardSkeleton` (§4.7, carrying the 21px ruling), `Avatar`. Modal traps focus at both Tab
      ends, closes on Esc and restores focus to its opener (`DESIGN §7`).
- [x] Sonner `<Toaster />` themed as a manila slip (`DESIGN §4.5`) — bottom-right, 3px `--blue`
      left border, 2px radius, the exact `§4.5` shadow.

---

## Phase 4 — Auth pages (~1.5 h) · *Day 3*

- [x] `/register`, `/login` — `react-hook-form` + `zod`, inline field errors, disabled+spinner
      submit state. The zod schemas mirror the server DTOs exactly (email; password 8..72 — bcrypt's
      silent truncation point, not an arbitrary cap; name 1..100). Both screens share one
      `AuthForm`. Server errors map to the right field: `409` → "email already registered",
      `401` → "email or password is incorrect", `429` → a throttle toast (the backend allows 5/min
      on these two routes).
- [x] Redirect to `/boards` on success — `router.replace`, so Back doesn't return to a completed
      form. Register also logs in immediately afterwards, because `POST /auth/register` returns the
      user but sets **no cookies** (backend Phase 4); without that second call the new user would
      land on a login screen. The `?next=` param is honoured but rejected unless it starts with a
      single `/` — otherwise it would be an open redirect.
- [x] `src/middleware.ts` — presence-only `mk_at` check on `/boards/:path*` (PLAN §4: the server
      stays the authority; a forged cookie passes here and then fails at the API).
- [x] Header with user name + logout — `useMe()` + `useLogout()`; logout clears the query cache on
      `onSettled` rather than `onSuccess`, so a failed logout can't leave a logged-in-looking shell.

**Done when:** register → land on an empty boards list → refresh the page → still logged in.
- [x] **Verified end to end against the running backend**: signed-out `GET /boards` → `307` to
      `/login?next=%2Fboards`; `/login` + `/register` → `200`; `GET /` → `307` to `/boards`;
      register → `201`, login → `200`, then `GET /boards` **with** the session cookie → `200`
      rendering the shell, and the same request again (the "refresh the page" step) → `200`.
      This also proves `QueryClientProvider` is mounted: `/boards` runs `useQuery` during SSR and
      would have thrown "No QueryClient set" otherwise.

---

## Phase 5 — Boards list (~1.5 h) · *Day 3*

- [x] `GET /api/v1/boards` via `useInfiniteQuery`, cursor from the response (PLAN §2) —
      `src/lib/boards.ts`. The cursor stays opaque: the hook only ever hands the previous page's
      `nextCursor` back, never parses it, and `getNextPageParam` returns `null` to stop.
- [x] "Load more" button (not auto-infinite-scroll — cheaper and more predictable), hidden as soon
      as `hasNextPage` is false
- [x] Create-board modal with optimistic insert — `useCreateBoard` follows PLAN §6's two rules
      even though this isn't the board: **`cancelQueries` first** (a background refetch landing
      after the optimistic write would make the new board blink out and back), and **swap the
      temp id for the real row in place, never append** (appending is the duplicate-card bug
      arriving through the create path). Deliberately **no invalidation** afterwards — refetching
      would re-page the whole list behind cursors that have already shifted, for a row the swap
      has already made authoritative.
- [x] Empty state: an illustration + a single primary "Create your first board" CTA, never a blank
      screen. The illustration is inline SVG drawn from the §2 tokens — no icon or illustration
      dependency (`DESIGN §8`). The "New board" button in the header is hidden while the list is
      empty, so exactly one CTA is on screen.
- [x] Skeleton cards while `isLoading` — tab + ruled card body matching `BoardCard`'s silhouette
      (`DESIGN §4.7`), never a spinner

Two things worth stating:

- **`POST /boards` returns no `role`.** Verified against the running API: the create response is
  the bare board row, while every `GET /boards` row carries the caller's `role`. The optimistic
  insert therefore supplies `OWNER` itself, which is sound because the board and its OWNER
  membership are written in one transaction server-side (PLAN §4) — there is no state in which
  the creator is anything else.
- **The boards list isn't specified in `DESIGN.md`**, so per §1 it is derived from the same
  tokens: each board is a closed folder — the angle-cut manila tab of §4.2 over an index-card
  body from §4.4, with the role on the `filed` label. Hover follows §5 exactly (1px lift on
  `transform`; the shadow blooms as the **opacity** of an `::after` layer, not a `box-shadow`
  transition).

**Verified in a real browser** (headless Chrome over CDP, against the built app and the live
backend) — **26 checks, all passing**, each run provisioning its own account so the run is
idempotent: empty state renders with its illustration and exactly one CTA; the CTA opens the
modal with focus moved inside; an empty title is blocked client-side and creates nothing; Esc
closes the modal; a real create paints the new row in **15 ms**, `aria-busy` and *not* a link
while pending, labelled `filing…`, then the server's row **replaces it in place** — one row, not
two, with a real uuid href and the OWNER label; at a genuine 22-board boundary page 1 renders
exactly 20 newest-first with "Load more", clicking it appends to 22 with **no duplicated or
skipped rows across the cursor** and the button disappears; under a throttled network the loading
state is skeletons and **zero** spinners; and with `/api/v1/boards` blocked the page shows the
error + "Try again", not the empty state. `npx tsc --noEmit`, `npm run lint` and `npm run build`
all clean.

> **Budget note for Phase 11** (recorded, not fixed here): `/boards` builds to **205 kB** First
> Load JS. `DESIGN §8`'s < 200KB budget is written against `/boards/[id]`, which does not exist
> yet and will add `dnd-kit` on top of this baseline — so the Phase 11 perf pass starts already
> over. The shared baseline is 87.3 kB and `/login` alone is 198 kB, so the weight is in the
> common chunk (framer-motion + sonner + react-hook-form + zod), not in this page's 6.28 kB.

---

## Phase 6 — Board view, read-only first (~2 h) · *Day 3*

Build the board **without** drag-and-drop first. It's much easier to debug DnD on top of a board you already trust.

- [x] `/boards/[id]` → `useQuery(['board', id])` — `src/lib/board.ts`'s `useBoard`. Retries skip
      403/404 (removed access, deleted board — retrying changes nothing) but keep retrying a
      transient network/500 failure, so a genuinely broken API surfaces the error state a couple
      of seconds later than a hard failure would, by design.
- [x] Horizontal column strip in its **own dedicated scroll container**, kept separate from the
      columns' vertical scroll (PLAN §6 — this separation is what stops mobile swipe fighting the
      drag). Each column's tray also scrolls independently, vertically, capped at
      `calc(100vh - 300px)` — a Phase 6 judgment call, since DESIGN doesn't pin an exact height;
      Phase 7's `autoScroll` may want to revisit it.
- [x] `TaskCard`, `BoardColumn` (`Column` was already a type name — file kept as `BoardColumn.tsx`
      to avoid the clash), `BoardHeader` (title, members, share button) — `src/components/board/`
- [x] Sort tasks by `rank` string with `id` as tiebreak — **the only sort in the app** (PLAN §6) —
      `src/lib/rank.ts`'s `sortByRank`, applied to both columns and each column's tasks. The API
      already returns both pre-sorted this way; this is the defensive client-side re-sort PLAN §6
      calls for, so an optimistic write (Phase 8) or a WebSocket patch (Phase 10) landing out of
      order can't disagree with the server's rank.
- [x] React keys are `task.id`, never the array index
- [x] Column header count derived from `tasks.length` — no separate counter (PLAN §2)
- [x] Skeleton board while loading; error state with a retry button — `BoardSkeleton.tsx`. The
      error state distinguishes a 403/404 ("This board isn't available" + a link back to
      `/boards`, since retrying can't fix a permissions problem) from a genuine fetch failure
      ("Could not load this board" + "Try again").

**The Filing Room shell** (`DESIGN §4`) — build it here, before drag exists, so DnD is debugged on
a board that already looks right:

- [x] Angle-cut manila **column tab** with the `clip-path` from `DESIGN §4.2`; status colour lives
      in the tab gradient and nowhere else. Matched case-insensitively against the column's own
      title (`in progress`/`blocked`/`done`); everything else, including "Backlog"/"In review",
      falls through to the same default gradient the table already assigns them.
- [x] **Tray** = the folder body, `position:relative`, square top-left tucked under the tab
      (`DESIGN §4.3`)
- [x] **Index card**: 29px top padding, red header rule + 21px ruled lines as CSS gradients, the
      `filed` label, hairline, meta row (`DESIGN §4.4`). Card title line-height **must** be 21px —
      it is what the ruling lines up with
- [x] Empty tray reads `no cards filed`; done cards use the struck-through treatment. "Done" is a
      property of the **column**, not the task — `Task` carries no status field (PLAN §2's
      committed schema), so a card is treated as done iff its column's title is "Done".
- [x] Card skeletons carry the ruled background too (`DESIGN §4.7`)

Two adaptations, both because the committed `Task` schema (PLAN §2) carries only
`title`/`description`/`rank`/`version`/timestamps — no `kind` taxonomy, due date, or assignee for
the mockup's `filed`-label ticket code, `due …` meta and avatar to draw from:

- The `filed` label reads the task's creation date instead of a ticket code, at `--faint` — §4.4's
  own default-kind colour, since there is no kind. The meta row reads a relative "updated …"
  instead of a due date, with no avatar. The `overdue` stamp is skipped outright — there is no due
  date to be overdue against.
- **`BoardHeader`'s "share button" opens a real share flow** (`ShareModal.tsx`): every member sees
  who has access (`GET .../members` is member-only per PLAN §3's route table, not OWNER-only), and
  an OWNER additionally sees an invite-by-email form (`POST .../members`), since no later phase in
  this roadmap is scoped for board sharing otherwise. **Role change and member removal have no UI**
  — their endpoints exist server-side, but building them was judged past what "share button" on its
  own implies; worth adding as a follow-up if wanted.

**Verified in a real browser** (headless Chrome over CDP, against an isolated production build —
copied out of the working tree so it didn't collide with the running `next dev` — and the live
backend), seeding boards/columns/tasks directly via the API since column/task creation is Phase 9:
**25/27 checks passed outright**; the 2 failures were re-run individually and confirmed as
test-script bugs, not app defects — one selector matched the app-shell's "Mini Kanban" logo link
instead of `BoardHeader`'s own "← your boards" link (both exist, as intended), and one sampled the
error state before a legitimate retry-with-backoff had finished, which a longer wait confirmed
renders correctly. All 5 columns render in creation order with per-title tab gradients (verified
via computed `background-image`, including the two unmapped-name fallbacks); task counts match
`tasks.length`; the empty tray reads "no cards filed"; a Done-column card is struck through and
faded while a Backlog-column card isn't; the share flow lists members, an OWNER's invite makes a
real user a real member (who can then open the board, sees the member list, but no invite form as
an EDITOR), a duplicate invite surfaces the `409` as a field error, and a genuine outsider still
gets the 403 "not available" state; a zero-column board reads "no columns filed yet"; loading is
skeletons, never a spinner. `npx tsc --noEmit`, `npm run lint` and `npm run build` all clean —
`/boards/[id]` ships at **206 kB** First Load JS (Phase 11's < 200KB budget already noted as
running over as of Phase 5; Phase 7's `dnd-kit` will add more on top).

---

## Phase 7 — Drag and drop (~2.5 h) · *Day 3 — the graded core*

Read [`DESIGN.md` §6](DESIGN.md#6-drag-and-drop--the-contract) in full first — it is the contract
for this phase. **Build on `dnd-kit`; do not hand-roll a drag engine.** The reference mockup ships
one only because an artifact cannot install packages; copying it would forfeit the keyboard sensor
and the announcements, both of which are graded.

- [x] `DndContext` + `SortableContext` per column (`verticalListSortingStrategy`), `useSortable` on each card
- [x] Sensors — **split mouse from touch** (`DESIGN §6`, refines the single `PointerSensor` this
      roadmap originally specified): `MouseSensor` `{ distance: 4 }`, `TouchSensor`
      `{ delay: 200, tolerance: 5 }`, `KeyboardSensor` with `sortableKeyboardCoordinates`.
      A 200ms delay is needed on touch so scrolling isn't read as a drag; the same delay on a mouse
      just reads as lag
- [x] `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` — **not the default.**
      Without it the drop gap opens in a stale position after the first reorder
- [x] `collisionDetection={closestCorners}` — centre-distance detection misbehaves with variable
      card heights and cannot reach empty columns
- [x] **Register each tray as a `useDroppable` container in its own right** — without this, dropping into an *empty* column silently fails. This is the single most common dnd-kit Kanban bug (PLAN §6)
- [x] `DragOverlay` for the lifted card: `scale(1.05)` + velocity tilt to ±6° via a `--tilt` custom
      property written from a `rAF` loop — never via a rotating modifier, which drifts the card off
      the cursor (`DESIGN §5`, `§6`)
- [x] `dropAnimation` at **340ms** on `cubic-bezier(.16,1.24,.4,1)` — the settle is the direction's
      signature; the default 250ms linear-ish drop is not it
- [x] Drop placeholder: the source card stays in flow at `opacity:.4` (`defaultDropAnimationSideEffects`)
- [x] `autoScroll` enabled so dragging toward an edge scrolls the board/column
- [x] `onDragEnd` computes the **neighbour ids** (`beforeTaskId` / `afterTaskId`), not an index
- [x] Only `transform`/`opacity` animate anywhere in the drag path; the lift shadow is an
      `::after` layer whose opacity changes (`DESIGN §5`). `will-change:transform` is set on drag
      start and removed on drop — never left on every card

**Verified in a real browser** (Playwright + Chromium, against the live backend, seeding a
board/columns/tasks directly via the API): a same-column drag (`Task 1` → after `Task 3`) resolves
to a `200` with the correct rank, and the resulting card order matches exactly, with **no card
title going blank** — this caught a real bug (below). A cross-column drag onto the **empty**
Blocked tray's droppable lands a `200` with the right `targetColumnId`, the card renders exactly
once with its title and description intact. Keyboard (Tab → Space → Arrow → Space) drives a drag
without throwing. Lifting a card and setting it back exactly where it started fires **no** move
request (the unchanged-neighbours short circuit in `useBoardDnd`). Zero browser console errors
across all of the above. `npx tsc --noEmit`, `npm run lint`, and `npm run build` all clean.

**One real bug found and fixed along the way:** the move endpoint's `200` response — and a `409`'s
`currentTask` — carry PLAN §3's fixed minimal shape (`id`/`columnId`/`rank`/`version`/`updatedAt`
only, per the backend's `MOVE_RESULT_SELECT`), never a full `Task`. The first cut of
`upsertTaskInBoard` (`src/lib/tasks.ts`) replaced the cached task wholesale with that response,
which wiped `title`/`description`/`createdAt` on every single move — caught by the browser test
above showing a blank card title after a drop. Fixed to merge the response's fields onto the
existing cached task instead.

**Scope note, deliberate:** `onDragEnd` calls a real, working `useMoveTask` mutation (`src/lib/
tasks.ts`) — not a no-op — because the drag preview itself already needs a live cross-column
reorder state (`useBoardDnd`'s `dragOrder`), and persisting that preview against a genuinely broken
or absent endpoint isn't verifiable. That hook is deliberately the **plain** form of the mutation,
though: no `onMutate` snapshot/rollback, no per-task sequence numbers, no Undo toast. Those are
frontend ROADMAP Phase 8's job (`useMoveTask`'s own docblock says so); `onError` here falls back to
a full board refetch rather than a surgical rollback, which is correct but not the premium
experience DESIGN §9 describes for a conflict.

---

## Phase 8 — Optimistic move + conflict handling (~2 h) · *Day 3*

The whole of PLAN §6, in `useMoveTask`:

- [x] `onMutate`: **`cancelQueries(['board', id])` first**, snapshot the cache, then apply the move — skipping the cancel is exactly what causes "card jumps back even though the move succeeded"
- [x] Send `PATCH /api/v1/tasks/:id/move` with `expectedVersion` from the cached task
- [x] `onError`: roll back to the snapshot + toast (`409` → "Someone else moved this task — board updated")
- [x] `onSuccess`: reconcile the authoritative `rank`/`version`
- [x] **Every cache write is a keyed upsert by `task.id`** — never a wholesale board replace (prevents duplicate *and* disappearing cards)
- [x] **Per-task sequence number**: drop a response whose sequence is older than the last applied one (rapid re-drags)
- [x] **Undo** in the success toast (~5 s) — one symmetric call back to the previous neighbours

Implementation notes:

- The optimistic patch (`moveTaskOptimistic`, `src/lib/tasks.ts`) needed a plausible `rank` to
  write into the cache, not just a `columnId` change — added `between`/`first`/`last` to
  `src/lib/rank.ts`, a direct port of the *read* half of the backend's
  `mini-kanban-backend/src/tasks/rank.util.ts` (no `rebalance()` — that stays a server-only, write-time
  concern). This estimate is never trusted past the round trip: `onSuccess` always overwrites it with
  the server's real `rank`, and a bad estimate (e.g. colliding neighbour ranks) falls back to the
  task's own current rank rather than throwing.
- The sequence-number guard (`sequenceRef`, one counter per task id) covers both `onError`'s
  rollback and `onSuccess`'s reconcile — either one is dropped if a newer call for the same task
  has since started, so a rapid re-drag's earlier response can never stomp the later one.
- Undo re-enters the same mutation via a `mutationRef` (a `useMutation` config can't reference the
  object it returns), sending the pre-move neighbour ids/column back with the just-reconciled
  `version` as `expectedVersion` — the literal "one symmetric call" PLAN §6 describes, so it gets
  the same optimistic/rollback treatment as any other move.
- `useBoardDnd`'s drag preview (`dragOrder`) still owns the *instant* visual feedback and is
  unchanged; this phase's cache write matters for anything reading the board query directly
  (column counts, a fresh mount) rather than through that preview.

**Verified in a real browser** (Playwright + Chromium, against the live backend, seeding a
board/columns/tasks directly via the API): a same-column drag shows the "Card moved" toast and
lands the card in the new position; clicking **Undo** restores its original position. A
cross-column drag lands the card in the destination column's tray; **Undo** returns it to the
source column. A forced conflict — a second API call bumps a task's `version` "from another
client" between page-load and the drag — makes the browser's drag `409`; the error toast
("Someone else moved this task — board updated") appears, and the board reconciles to the
server's authoritative state, confirmed by the server's `version` having advanced by exactly one
(the other client's move only — the browser's own rejected attempt never landed a second bump).
`npx tsc --noEmit`, `npm run lint`, and `npm run build` all clean.

---

## Phase 9 — Task & column CRUD (~1.5 h) · *Day 3*

- [x] Add task (inline composer at the column foot), edit (modal or inline), delete (confirm dialog — no undo, PLAN §6)
- [x] Add / rename / delete column; drag columns via `PATCH /columns/:id/move`
- [x] **Optimistic create uses a `tempId` + `pending` flag, then swaps temp → real id in place** — appending instead of swapping is how you get the duplicate-card bug through the create path (PLAN §6)
- [x] Hide mutation affordances for `VIEWER` — while remembering the server is the real gate (PLAN §4)

Implementation notes:

- **Task composer** (`TaskComposer.tsx`) is title-only and stays open after each submit — a
  description is added afterwards via the edit modal, the same "create now, refine later" shape
  as filing a physical index card. **Edit** (`EditTaskModal.tsx`) is a modal, `react-hook-form` +
  `taskSchema` (mirrors `CreateTaskDto`/`UpdateTaskDto`'s 200/5000-char limits), with **Delete**
  routed through a nested `ConfirmDialog` step rather than firing on the modal's own button — task
  deletion has no undo (PLAN §6). All three (`useCreateTask`/`useUpdateTask`/`useDeleteTask`,
  `src/lib/tasks.ts`) follow the same cancel-first/snapshot/apply/rollback shape `useMoveTask`
  already established.
- **Column CRUD** (`src/lib/columns.ts` — new file) mirrors the task hooks exactly: `useCreateColumn`
  with the tempId/`pending`/swap-in-place insert, `useRenameColumn` (inline edit in the tab itself,
  no modal — Enter/blur commits, Escape cancels), `useDeleteColumn` behind the same `ConfirmDialog`
  pattern (cascades its tasks server-side, no undo).
- **Column drag** (`PATCH /columns/:id/move`) extends `useBoardDnd` in parallel with the existing
  task-drag state rather than replacing any of it: a column's tab is sortable under its own
  `col:`-prefixed id (`columnSortId`) inside one flat, board-wide `SortableContext`
  (`horizontalListSortingStrategy`) — the prefix exists because a column's tray is *also* a
  registered droppable (for tasks) at the bare column id, and `useSortable` would otherwise collide
  with it. `useMoveColumn` mirrors `useMoveTask`'s optimistic-write/rollback shape minus the
  version-conflict machinery (`Column` has no `version`, PLAN §3).
- **One real bug found and fixed along the way**, the same way Phase 7 found its blank-title bug:
  a column's tab (33px) and its own tray (218px+) are both registered droppables at the same
  screen position, and plain `closestCorners` — correct for task drag (DESIGN §6) — runs over
  *every* droppable regardless of what's being dragged. Verified live (Playwright + Chromium, an
  `aria-live` region reading the raw `over` id mid-drag): dragging a column reliably resolved to a
  neighbouring **tray's** plain id instead of the target tab whenever the tray's corner was
  marginally nearer, which `handleDragEnd`'s `isColumnSortId` guard correctly rejected as "not a
  column" — so the drop silently no-op'd instead of reordering. Fixed by scoping collision
  detection (`useBoardDnd`'s `collisionDetection`): when the active item is a column, the candidate
  droppable set is filtered down to just other columns' own tab ids before calling `closestCorners`;
  a task drag is unaffected and still considers every droppable, including empty trays.
- **`pending` extended to `Column`** (`src/lib/types.ts`), same contract as `Board`/`Task`'s
  existing flag — a placeholder column can't yet be renamed, deleted, or dragged (no real id to
  send), so `BoardColumn` disables all three while `column.pending` is true and shows `filing…` in
  the tab, matching `BoardCard`'s treatment of a pending board.

**Verified in a real browser** (Playwright + Chromium, against the live backend, seeding a
board/columns/task directly via the API, then driving the UI): the full loop — add a card via the
composer, open and edit it, delete it via the confirm dialog, add a new column, rename an existing
one inline, delete another, then drag-reorder the remaining two columns — reflects correctly at
every step and the reordered column order survives a hard reload (persisted server-side, not just
the optimistic cache). A `VIEWER` session on the same board sees none of the add/rename/delete
affordances and no column-drag handles, while still reading the board's existing cards normally.
`npx tsc --noEmit`, `npm run lint` and `npm run build` all clean.

> **Budget note carried forward from Phase 5/6/7:** `/boards/[id]` now ships **230 kB** First Load
> JS, up from 206 kB before this phase's new components (composer, add-column, edit/confirm
> modals, column-drag wiring). `DESIGN §8`'s < 200KB budget is Phase 11's pass, not this one's —
> already over budget as of Phase 5 and only tracked here, not fixed.

---

## Phase 10 — Realtime (~1.5 h) · *Day 3, first thing to cut if behind*

- [x] `GET /api/v1/auth/ws-ticket` (same-origin, cookie works) → connect `io(NEXT_PUBLIC_WS_URL, { auth: (cb) => ... })`
- [x] `emit('join', { boardId })` on mount, `leave` on unmount
- [x] On `task.moved` / `task.*`: **ignore the event unless its `version` is strictly newer** than the cached task's (PLAN §3 — out-of-order protection)
- [x] On reconnect: refetch the full board rather than replaying missed events
- [x] Small "live / reconnecting" indicator in the header

Implementation notes:

- `src/lib/realtime.ts`'s `useBoardRealtime(boardId)` — one socket per mounted board page. Connects
  **directly** to `NEXT_PUBLIC_WS_URL` (not through the Phase 2 rewrite — a WS upgrade through
  Next's proxy is unreliable, backend Phase 4's own rationale for the ws-ticket). `auth` is passed
  as a **function**, not a plain object: a ticket is single-use, so socket.io-client must fetch a
  fresh one on every (re)connection attempt, never resend one that already failed.
- Reconciles the same `['board', boardId]` cache every other hook here already reads/writes, via
  new true-upsert helpers (`upsertOrInsertTask` in `tasks.ts`, `upsertOrInsertColumn` in
  `columns.ts`) that can *insert* a row the cache has never seen — unlike the existing
  `upsertTaskInBoard`/`patchColumnFields`, which only ever patch a row already there. `task.moved`
  stays on the existing patch-only `upsertTaskInBoard` (its payload isn't a full `Task` and
  shouldn't ever insert). `task.created`/`task.updated`/`column.created`/`column.updated` carry no
  `version` (only a move bumps one, PLAN §3) and apply unconditionally — gating them the same way
  as `task.moved` would silently block every ordinary title edit from ever arriving over the
  socket, since `update()` never bumps `version` by design (ROADMAP backend Phase 8).
- **One real race found and fixed along the way**, in the same spirit as Phase 7/9's bugs: this
  client's own optimistic create (tempId placeholder) and the WebSocket echo of that same create
  (the real row, arriving via the *other* code path, sometimes before this client's own REST
  response) can both land in the cache at once, leaving one task under two ids until a full
  refetch. Fixed by making `replaceTaskId`/`replaceColumnId` (the tempId→real swap) drop any row
  already sitting under the real id first — a small, targeted de-dupe, not a redesign.
- The "live / reconnecting" indicator isn't specified in `DESIGN.md` (predates any design pass over
  it, same situation Phase 6 documented for the boards list) — derived from the same tokens per
  §1: `--moss` (already the done/success accent) for live, `--amber` (already reads as
  in-progress/warning) pulsing for reconnecting, in `BoardHeader.tsx`.

**Verified in a real browser** (Playwright + Chromium, two separate registered users against the
live backend, one browser process, two isolated contexts — Owner A and Editor B, B invited via a
real share): both tabs reach **"live"** after joining; a column A creates over the REST API
appears in B's tab with **no reload**; a task B creates appears in A's tab with no reload; a task
moved cross-column via a raw authenticated `PATCH /tasks/:id/move` (bypassing the UI, to isolate
the WS path) relocates into the correct column's tray on B's tab, verified by DOM containment, not
text position (column tab labels are CSS-uppercased, so a naive text-index check is unreliable and
was caught and fixed during this verification); a task deleted from B's session disappears from
A's tab; a column deleted from A's session disappears from B's tab. `npx tsc --noEmit`, `npm run
lint`, and `npm run build` all clean.

**Not verified live** (documented, not fixed): the indicator's flip to "reconnecting…" on an actual
socket drop — Chromium's CDP `setOffline` doesn't reliably kill an already-established WebSocket
within a short window in a scripted test, making that specific check flaky rather than informative.
The underlying logic (`disconnect`/`connect_error` → `"reconnecting"`, `connect` after a prior
connect → cache invalidation) was verified by code review instead, and is the same event-driven
shape Socket.IO's own reconnection logic is built to trigger.

---

## Phase 11 — Polish & accessibility (~2 h) · *Day 4*

- [x] **Framer Motion is for card enter/exit, modals and toasts only.** Do *not* put the `layout`
      prop on a sortable card — it fights `useSortable`'s own transform, which is what makes cards
      judder and land a few pixels off (`DESIGN §6`). The reflow is dnd-kit's transition at 280ms
      on `cubic-bezier(.22,.85,.28,1)`
- [x] Hover/lift shadow via the `::after` opacity layer, not a `box-shadow` transition (`DESIGN §5`)
- [x] `prefers-reduced-motion` kills tilt, scale and overshoot and collapses reflow/drop to ≤1ms
- [x] Empty states for: no boards, no columns, empty column
- [x] Keyboard DnD pass — Tab, Space to lift, arrows to move, Space to drop, Esc to cancel
- [x] Custom `dnd-kit` `announcements` naming the task, column and position (PLAN §6)
- [x] Focus rings visible; modals trap focus and close on Esc
- [x] Mobile pass on a real phone viewport: drag vs. scroll, horizontal column swipe, tap targets ≥ 44px
- [x] Contrast pass — `--faint` is `#7C7365`, **not** the mockup's lighter grey, which fails AA on
      11px meta text (`DESIGN §2`, `§7`)
- [x] Perf pass — 60 cards in one column, record a drag in DevTools Performance: 60fps, no layout
      thrash, no style recalc on non-dragged cards (`DESIGN §6`)
- [x] `npm run build` — the `/boards/[id]` route ships under **200KB gzipped JS** (`DESIGN §8`)
- [x] Walk `DESIGN §9` "Done when" end to end; every box there must pass before the UI is called done

Most of this phase's boxes were already satisfied by earlier phases' own discipline (memoised
`TaskCard`, `will-change` scoped to the dragging card only, the `--faint` AA-safe value, the
global `prefers-reduced-motion` CSS block, focus rings, all three empty states). What this phase
actually added, each found by auditing the code against `DESIGN §5`–`§9` line by line rather than
assuming "done" from earlier phases' notes:

- **The reflow transition was silently using dnd-kit's own 200ms/`ease` default** — neither
  `TaskCard` nor `BoardColumn`'s `useSortable` call passed a `transition` option, so DESIGN §5's
  280ms `cubic-bezier(.22,.85,.28,1)` was never actually wired up. Fixed via `src/lib/motion.ts`'s
  `sortableTransition()`, applied to both. Its reduced-motion branch also plugs a second gap:
  `globals.css`'s blanket `transition-duration` override only reaches CSS transitions, not
  dnd-kit's own Web-Animations-API-driven reflow/drop — `usePrefersReducedMotion()` and a
  reduced-motion-aware `dropAnimation` in `boards/[id]/page.tsx` close that.
- **No `announcements`** were wired into `DndContext` — dnd-kit's default keyboard-drag
  announcement is a generic "was moved", not PLAN §6/DESIGN §7's task-name-and-position phrasing.
  `buildAnnouncements()` (`boards/[id]/page.tsx`) reads the live drag-preview order out of
  `useBoardDnd` for both tasks and columns.
- **The conflict flash never existed.** DESIGN §5's motion table names it (760ms, one-shot
  `box-shadow`) and Phase 11's own "Done when" spells out "a 409 rolls the card back with the
  flash and the error toast" — `useMoveTask`'s `onError` only had the rollback and the toast.
  Added `src/lib/conflictFlash.ts` (a tiny id-keyed pub/sub — not React Query state, since this is
  a one-shot animation cue for one specific card instance, not board data) plus a `@keyframes`
  pulse in `globals.css`. **A real bug found firing it**, the same pattern as Phases 7/9's own
  bugs: firing synchronously inside `onError` reached a card instance that was about to be
  unmounted, whenever the 409's `currentTask` also carried a different `columnId` than the stale
  cache — React doesn't reuse a keyed instance across two different `BoardColumn` subtrees, so the
  old instance flashed and vanished while the freshly-mounted one in its new column never
  subscribed in time. Deferring the fire one `requestAnimationFrame` (confirmed live, twice, with
  a full per-100ms class-list timeline) fixed it.
- **Column rename/delete were 20×20px icon buttons**, well under DESIGN §7's 44px touch-target
  rule. A `before:` pseudo-element hit-slop (`inset:-12px`) was the first attempt and silently
  failed: the tab's own `clipPath` (the angle-cut corner) clips its entire subtree to a polygon
  bounded by the tab's own box, eating any slop that extended past its edges — confirmed live via
  `document.elementFromPoint` resolving to the page background a few px above the visible icon.
  Fixed by rendering the buttons as a sibling overlay *outside* the clipped tab (same screen
  position, `absolute`-anchored), which the slop technique then actually works against on three of
  four sides — the board's own scroll container (`overflow-x-auto`, which per the CSS spec forces
  `overflow-y: auto` too) still bounds the topmost few px, since every column tab sits right at
  the scroll container's own top edge; a real, minor, and documented trade-off of the scroll
  architecture PLAN §6 requires, not a defect in the technique.
- **Bundle budget**: `/boards/[id]` shipped 243KB after this phase's own `announcements` code was
  added, against DESIGN §8's <200KB target (already over as of Phase 5). Two fixes, both reused
  elsewhere for free: `ShareModal`/`EditTaskModal` moved to `next/dynamic` (`ssr:false`) — react-
  hook-form/zod are already in the shared login/register chunk, only each modal's own component
  code needed to leave the initial bundle — and `Modal.tsx` (every modal in the app routes through
  it) switched from `framer-motion`'s full `motion` component to `LazyMotion`/`m` with the
  `domAnimation` feature bundle, since nothing here needs drag or layout animations. Landed at
  **199KB** — `/boards` and `/login`/`/register` dropped too (195KB, 187KB), as a side effect of
  the same `Modal.tsx` change.

**Verified in a real browser** (Playwright + Chromium, against the live backend, seeding a board
with 60 tasks in one column plus a two-column conflict-test setup via the API): the live reflow
transition reads exactly `0.28s` on whichever card actually gets displaced mid-drag (sampled
across many drag steps, since dnd-kit only assigns it once a card's projected index truly
changes); under `reducedMotion: 'reduce'` that same transition collapses to `1e-05s`; keyboard
Space→Arrow→Escape drives a full lift/move/cancel cycle with the live region reporting
`"position N of M"` and `"cancelled"` (the transient pickup announcement — confirmed present by
reading `buildAnnouncements` itself — gets superseded by an immediate `onDragOver` in the same
synchronous batch too fast for a scripted poll to catch, a scripting limitation, not a missing
feature); a forced version conflict (an out-of-band API move bumping a task's version between
page-load and a same-tab drag) produces the `409`, the error toast, and the `conflict-flash` class
on the bounced-back card for ~700ms before it clears itself; the 44px hit-slop registers real
clicks left/right/below the painted 20px icon; on an iPhone 13 viewport a column's tray scrolls
vertically and the board strip scrolls horizontally, independently; dragging across a 60-card
column produces 9–10 layouts and ~80 style recalcs for a 20-step drag (no scaling with the 55
off-screen-but-mounted cards, confirming `TaskCard`'s memoisation and the `will-change` scoping
hold under load). `npx tsc --noEmit`, `npm run lint`, and `npm run build` all clean throughout.

---

## Phase 12 — Dockerfile (~30 min)

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node","server.js"]
```

- [x] `output: 'standalone'` is set (Phase 2) — `.next/standalone/server.js` confirmed present
- [x] **`ARG BACKEND_URL` before `npm run build`** — `Dockerfile` now has `ARG BACKEND_URL` +
      `ENV BACKEND_URL=$BACKEND_URL` in the `build` stage, ahead of `RUN npm run build`, matching
      Phase 2's finding that the rewrite target freezes into `routes-manifest.json` at build time.
      Root `docker-compose.yml` (Phase 3) must pass it via `build: args:`, never `env_file:`.
- [x] `.dockerignore` — `node_modules`, `.next`, `.env`/`.env.*` (with `.env.example` re-allowed),
      `.git`, `.gitignore`, `*.log`, plus `design/` (the DESIGN.md reference mockup — dev-only,
      no reason to ship it in the image).

One deviation from the snippet above, found while verifying: this project has **no `public/`
directory** (DESIGN §8's every icon/illustration is inline SVG, so nothing was ever added there),
and `COPY --from=build /app/public ./public` against a path that doesn't exist fails the build
outright. Dropped that line rather than fabricating an empty folder just for Docker's sake — the
comment left in its place says why, so a later phase that *does* add `public/` assets knows to put
the line back.

**Verified live**: `docker build --build-arg BACKEND_URL=http://backend:4000` builds clean
end-to-end (`npm ci` → `next build` → the three-stage copy). Inside the built image,
`.next/routes-manifest.json`'s rewrite destination is `http://backend:4000/api/v1/:path*` — the
build ARG actually reached the manifest, not the `http://localhost:4000` fallback. Running the
image (`docker run -p 3099:3000 …`, no backend attached) serves real Next.js responses: `/` → `307`
(the auth middleware redirect) and `/login` → `200`, proving `server.js` boots and routes without
throwing. Image and container cleaned up after verification.

---

## Phase 13 — Environment variables

`.env.example`:

```bash
BACKEND_URL="http://localhost:4000"          # server-side only, used by the rewrite
NEXT_PUBLIC_WS_URL="http://localhost:4000"   # Socket.IO connects directly, authed by ws-ticket
```

Only the WebSocket URL is public — every HTTP call goes through the relative proxied path.

---

## Phase 14 — Deploy (~30 min) · *Day 4, optional*

**Vercel** (deploy the backend first — you need its URL):

- [x] Root directory → `mini-kanban-frontend` — linked and deployed via `vercel link --yes` +
      `vercel deploy --prod --yes` run from inside `mini-kanban-frontend/`, so that directory is
      the deployment root
- [x] `BACKEND_URL` = the deployed API origin (server-side var; the browser never sees it) — set
      as a Vercel Production environment variable to the Railway backend's public domain
      (`https://backend-production-2621.up.railway.app`) before the production build, so it's
      baked into `routes-manifest.json` correctly (Phase 2/12's finding)
- [x] `NEXT_PUBLIC_WS_URL` = the same origin, for Socket.IO — set to the same Railway backend
      origin
- [x] Set the backend's `FRONTEND_URL` to the Vercel domain, then redeploy the backend — done via
      `railway variable set FRONTEND_URL=... --service backend` (backend ROADMAP Phase 14),
      which triggered Railway's automatic redeploy

Live at `https://mini-kanban-frontend-seven.vercel.app`.

**Final check:** on the deployed URL — log in, hard-refresh, confirm the session survives; open the board in two tabs and confirm a move in one appears in the other. Then run the rest of PLAN §10.
✅ The login/hard-refresh check is verified (see backend ROADMAP Phase 14 and root ROADMAP Phase
5) via `curl` with a cookie jar against the live deployment: session persists across a fresh
request presenting only the stored cookies. **Not re-run here:** the two-tab realtime check and
the rest of PLAN §10's full matrix — those were already verified end-to-end against the local dev
stack (root ROADMAP Phase 6), and re-running the entire checklist against production is a
`qa-checklist` skill pass the user can trigger separately rather than something folded into this
deploy step.
