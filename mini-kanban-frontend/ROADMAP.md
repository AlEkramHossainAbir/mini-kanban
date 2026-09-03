# Frontend Roadmap — Next.js + Tailwind + dnd-kit

Execution roadmap for the Mini Kanban frontend, from an empty folder to a deployed app.
Design decisions live in [`PLAN_EN.md`](../PLAN_EN.md) (`§` references point there) — this file is the *order of operations*.

**Target:** Node 20 LTS · Next 14 (App Router) · React 18 · TypeScript · Tailwind
**Serves:** `http://localhost:3000`, talking to the API at the **same origin** via `/api/v1/*`

---

## Phase 0 — Scaffold (~15 min)

```bash
cd mini-kanban-frontend
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

> **Pin Next 14 / React 18 deliberately.** Next 15 pulls React 19, where `dnd-kit` and some
> animation libraries still hit peer-dependency friction. In a 4-day build you cannot afford
> dependency archaeology — the assessment asks for Next.js, not for the newest Next.js.

- [ ] `npm run dev` serves the starter page on `:3000`
- [ ] Delete the boilerplate hero markup in `src/app/page.tsx`

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

- [ ] `BACKEND_URL` is a **server-side** variable (`http://localhost:4000` locally, the service name `http://backend:4000` in Docker) — deliberately *not* `NEXT_PUBLIC_*`
- [ ] All app code calls **relative** paths: `fetch('/api/v1/boards', { credentials: 'include' })`

> **Why this matters (PLAN §1):** the browser must only ever see one origin. `SameSite=Lax` cookies
> are not sent cross-site, so pointing the browser straight at a Railway/Vercel-split API would work
> on localhost and silently break login in production. Proxying keeps cookies first-party.
> As a bonus, nothing about the API URL gets baked into the client bundle at build time.

- [ ] Tailwind: set your palette + a `--radius` token in `tailwind.config.ts` now, so "premium" isn't a day-4 retrofit

---

## Phase 3 — Providers & primitives (~1 h) · *Day 3*

- [ ] `src/app/providers.tsx` — `QueryClientProvider` (`staleTime: 30_000`, `retry: 1`), Devtools in dev, `<Toaster />` from sonner
- [ ] `src/lib/api.ts` — thin `fetch` wrapper: always `credentials: 'include'`, always sends the CSRF header `X-Requested-With: mini-kanban` on mutations (PLAN §5), throws a typed `ApiError` carrying `status` + body
- [ ] **401 interceptor**: on `401`, call `/api/v1/auth/refresh` **once**, retry the original request, else redirect to `/login` (PLAN §1) — guard against refresh stampedes with a single shared in-flight promise
- [ ] `src/lib/types.ts` — `Board`, `Column`, `Task` (with `version`), `BoardRole`
- [ ] `src/components/ui/` — `Button`, `Input`, `Modal`, `Skeleton`, `Avatar` (hand-rolled + Tailwind is fine; a component library is not required)

---

## Phase 4 — Auth pages (~1.5 h) · *Day 3*

- [ ] `/register`, `/login` — `react-hook-form` + `zod`, inline field errors, disabled+spinner submit state
- [ ] Redirect to `/boards` on success
- [ ] `src/middleware.ts` — bounce unauthenticated users off `/boards/*` by checking the presence of the `mk_at` cookie *(presence only; the server is still the authority — PLAN §4)*
- [ ] Header with user name + logout

**Done when:** register → land on an empty boards list → refresh the page → still logged in.

---

## Phase 5 — Boards list (~1.5 h) · *Day 3*

- [ ] `GET /api/v1/boards` via `useInfiniteQuery`, cursor from the response (PLAN §2)
- [ ] "Load more" button (not auto-infinite-scroll — cheaper and more predictable)
- [ ] Create-board modal with optimistic insert
- [ ] Empty state: an illustration + a single primary "Create your first board" CTA, never a blank screen
- [ ] Skeleton cards while `isLoading`

---

## Phase 6 — Board view, read-only first (~2 h) · *Day 3*

Build the board **without** drag-and-drop first. It's much easier to debug DnD on top of a board you already trust.

- [ ] `/boards/[id]` → `useQuery(['board', id])`
- [ ] Horizontal column strip in its **own dedicated scroll container**, kept separate from the columns' vertical scroll (PLAN §6 — this separation is what stops mobile swipe fighting the drag)
- [ ] `TaskCard`, `Column`, `BoardHeader` (title, members, share button)
- [ ] Sort tasks by `rank` string with `id` as tiebreak — **the only sort in the app** (PLAN §6)
- [ ] React keys are `task.id`, never the array index
- [ ] Column header count derived from `tasks.length` — no separate counter (PLAN §2)
- [ ] Skeleton board while loading; error state with a retry button

---

## Phase 7 — Drag and drop (~2.5 h) · *Day 3 — the graded core*

- [ ] `DndContext` + `SortableContext` per column, `useSortable` on each card
- [ ] Sensors: `PointerSensor` with `activationConstraint: { delay: 200, tolerance: 5 }` and `KeyboardSensor` with `sortableKeyboardCoordinates`
- [ ] **Register each column as a `useDroppable` container in its own right** — without this, dropping into an *empty* column silently fails. This is the single most common dnd-kit Kanban bug (PLAN §6)
- [ ] `DragOverlay` for the lifted card (elevation + slight scale)
- [ ] Drop placeholder: a dashed gap the exact height of the dragged card
- [ ] `autoScroll` enabled so dragging toward an edge scrolls the board/column
- [ ] `onDragEnd` computes the **neighbour ids** (`beforeTaskId` / `afterTaskId`), not an index

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

- [ ] Framer Motion `layout` on task cards; Tailwind transitions for hover/lift shadow
- [ ] `prefers-reduced-motion` respected
- [ ] Empty states for: no boards, no columns, empty column
- [ ] Keyboard DnD pass — Tab, Space to lift, arrows to move, Space to drop, Esc to cancel
- [ ] Custom `dnd-kit` `announcements` naming the task, column and position (PLAN §6)
- [ ] Focus rings visible; modals trap focus and close on Esc
- [ ] Mobile pass on a real phone viewport: drag vs. scroll, horizontal column swipe, tap targets ≥ 44px

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

- [ ] `output: 'standalone'` is set (Phase 2)
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
