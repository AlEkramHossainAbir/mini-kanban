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

- [ ] `DndContext` + `SortableContext` per column (`verticalListSortingStrategy`), `useSortable` on each card
- [ ] Sensors — **split mouse from touch** (`DESIGN §6`, refines the single `PointerSensor` this
      roadmap originally specified): `MouseSensor` `{ distance: 4 }`, `TouchSensor`
      `{ delay: 200, tolerance: 5 }`, `KeyboardSensor` with `sortableKeyboardCoordinates`.
      A 200ms delay is needed on touch so scrolling isn't read as a drag; the same delay on a mouse
      just reads as lag
- [ ] `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` — **not the default.**
      Without it the drop gap opens in a stale position after the first reorder
- [ ] `collisionDetection={closestCorners}` — centre-distance detection misbehaves with variable
      card heights and cannot reach empty columns
- [ ] **Register each tray as a `useDroppable` container in its own right** — without this, dropping into an *empty* column silently fails. This is the single most common dnd-kit Kanban bug (PLAN §6)
- [ ] `DragOverlay` for the lifted card: `scale(1.05)` + velocity tilt to ±6° via a `--tilt` custom
      property written from a `rAF` loop — never via a rotating modifier, which drifts the card off
      the cursor (`DESIGN §5`, `§6`)
- [ ] `dropAnimation` at **340ms** on `cubic-bezier(.16,1.24,.4,1)` — the settle is the direction's
      signature; the default 250ms linear-ish drop is not it
- [ ] Drop placeholder: the source card stays in flow at `opacity:.4` (`defaultDropAnimationSideEffects`)
- [ ] `autoScroll` enabled so dragging toward an edge scrolls the board/column
- [ ] `onDragEnd` computes the **neighbour ids** (`beforeTaskId` / `afterTaskId`), not an index
- [ ] Only `transform`/`opacity` animate anywhere in the drag path; the lift shadow is an
      `::after` layer whose opacity changes (`DESIGN §5`). `will-change:transform` is set on drag
      start and removed on drop — never left on every card

---

## Phase 8 — Optimistic move + conflict handling (~2 h) · *Day 3*

The whole of PLAN §6, in `useMoveTask`:

- [ ] `onMutate`: **`cancelQueries(['board', id])` first**, snapshot the cache, then apply the move — skipping the cancel is exactly what causes "card jumps back even though the move succeeded"
- [ ] Send `PATCH /api/v1/tasks/:id/move` with `expectedVersion` from the cached task
- [ ] `onError`: roll back to the snapshot + toast (`409` → "Someone else moved this task — board updated")
- [ ] `onSuccess`: reconcile the authoritative `rank`/`version`
- [ ] **Every cache write is a keyed upsert by `task.id`** — never a wholesale board replace (prevents duplicate *and* disappearing cards)
- [ ] **Per-task sequence number**: drop a response whose sequence is older than the last applied one (rapid re-drags)
- [ ] **Undo** in the success toast (~5 s) — one symmetric call back to the previous neighbours

---

## Phase 9 — Task & column CRUD (~1.5 h) · *Day 3*

- [ ] Add task (inline composer at the column foot), edit (modal or inline), delete (confirm dialog — no undo, PLAN §6)
- [ ] Add / rename / delete column; drag columns via `PATCH /columns/:id/move`
- [ ] **Optimistic create uses a `tempId` + `pending` flag, then swaps temp → real id in place** — appending instead of swapping is how you get the duplicate-card bug through the create path (PLAN §6)
- [ ] Hide mutation affordances for `VIEWER` — while remembering the server is the real gate (PLAN §4)

---

## Phase 10 — Realtime (~1.5 h) · *Day 3, first thing to cut if behind*

- [ ] `GET /api/v1/auth/ws-ticket` (same-origin, cookie works) → connect `io(BACKEND_WS_URL, { auth: { ticket } })`
- [ ] `emit('join', { boardId })` on mount, `leave` on unmount
- [ ] On `task.moved` / `task.*`: **ignore the event unless its `version` is strictly newer** than the cached task's (PLAN §3 — out-of-order protection)
- [ ] On reconnect: refetch the full board rather than replaying missed events
- [ ] Small "live / reconnecting" indicator in the header

---

## Phase 11 — Polish & accessibility (~2 h) · *Day 4*

- [ ] **Framer Motion is for card enter/exit, modals and toasts only.** Do *not* put the `layout`
      prop on a sortable card — it fights `useSortable`'s own transform, which is what makes cards
      judder and land a few pixels off (`DESIGN §6`). The reflow is dnd-kit's transition at 280ms
      on `cubic-bezier(.22,.85,.28,1)`
- [ ] Hover/lift shadow via the `::after` opacity layer, not a `box-shadow` transition (`DESIGN §5`)
- [ ] `prefers-reduced-motion` kills tilt, scale and overshoot and collapses reflow/drop to ≤1ms
- [ ] Empty states for: no boards, no columns, empty column
- [ ] Keyboard DnD pass — Tab, Space to lift, arrows to move, Space to drop, Esc to cancel
- [ ] Custom `dnd-kit` `announcements` naming the task, column and position (PLAN §6)
- [ ] Focus rings visible; modals trap focus and close on Esc
- [ ] Mobile pass on a real phone viewport: drag vs. scroll, horizontal column swipe, tap targets ≥ 44px
- [ ] Contrast pass — `--faint` is `#7C7365`, **not** the mockup's lighter grey, which fails AA on
      11px meta text (`DESIGN §2`, `§7`)
- [ ] Perf pass — 60 cards in one column, record a drag in DevTools Performance: 60fps, no layout
      thrash, no style recalc on non-dragged cards (`DESIGN §6`)
- [ ] `npm run build` — the `/boards/[id]` route ships under **200KB gzipped JS** (`DESIGN §8`)
- [ ] Walk `DESIGN §9` "Done when" end to end; every box there must pass before the UI is called done

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
- [ ] **`ARG BACKEND_URL` before `npm run build`** (`ARG BACKEND_URL` + `ENV BACKEND_URL=$BACKEND_URL`).
      The Dockerfile snippet above does **not** do this yet and must be amended: the rewrite target
      is frozen into `routes-manifest.json` at build time (proved in Phase 2), so an image built
      without it bakes `http://localhost:4000` and every API call inside the container 502s, no
      matter what compose sets at run time. Compose must pass it via `build: args:`, not `env_file:`.
- [ ] `.dockerignore`: `node_modules`, `.next`, `.env*`, `.git`

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

- [ ] Root directory → `mini-kanban-frontend`
- [ ] `BACKEND_URL` = the deployed API origin (server-side var; the browser never sees it)
- [ ] `NEXT_PUBLIC_WS_URL` = the same origin, for Socket.IO
- [ ] Set the backend's `FRONTEND_URL` to the Vercel domain, then redeploy the backend

**Final check:** on the deployed URL — log in, hard-refresh, confirm the session survives; open the board in two tabs and confirm a move in one appears in the other. Then run the rest of PLAN §10.
