# Mini Kanban — Frontend

The web client for [Mini Kanban Board](../README.md): Next.js 14 (App Router) + React 18 +
TypeScript + Tailwind, with `dnd-kit` drag-and-drop and a Socket.IO client for realtime board sync.

> This directory is one half of a single-repository submission. See the
> [root README](../README.md) for Docker quick start, the full API table, and architecture
> rationale; see [DESIGN.md](DESIGN.md) for the "Filing Room" visual design system this UI
> implements.

## Tech stack

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [`dnd-kit`](https://dndkit.com/) for drag-and-drop
- Socket.IO client for realtime board updates
- Vitest for unit tests

## Running standalone

Needs a running backend to talk to (see the root README's
[Docker quick start](../README.md#quick-start-docker) to run the whole stack together instead).

```bash
npm install
BACKEND_URL=http://localhost:4000 npm run dev
```

Opens on [http://localhost:3000](http://localhost:3000). The app proxies `/api/v1/*` requests to
`BACKEND_URL` through a Next.js rewrite (`next.config.mjs`), so the browser only ever talks to one
origin — this is what keeps `SameSite=Lax` auth cookies first-party across a split deployment (see
[PLAN_EN.md §1](../PLAN_EN.md#1-system-architecture-overview)).

## Environment variables

See [.env.example](.env.example) for the annotated version. Both variables are read at **build**
time, not run time — changing either requires a rebuild.

| Variable | Purpose |
|---|---|
| `BACKEND_URL` | server-side only; where the rewrite proxy forwards `/api/v1/*` (e.g. `http://localhost:4000`, or `http://backend:4000` in Docker) |
| `NEXT_PUBLIC_WS_URL` | the Socket.IO endpoint, resolved directly by the browser — must be publicly reachable in a split deployment |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm run start` | production build and run |
| `npm run lint` / `npm run typecheck` | Next lint and `tsc --noEmit` |
| `npm test` | unit tests (Vitest, run once) |
| `npm run test:watch` | unit tests in watch mode |

## Tests

36 unit tests under Vitest, scoped to the pure logic rather than simulating drags in jsdom:
`lib/rank.ts` (fractional rank-string ordering), the optimistic-cache transforms in `lib/tasks.ts`,
and the drop→neighbor-id derivation in `components/board/neighbors.ts`. These are the pieces where
a silent regression corrupts board order; the drag interaction itself is covered by the manual QA
matrix in [PLAN_EN.md §10](../PLAN_EN.md#10-testing--qa-checklist).

```bash
npm test
```

## Project layout

```
src/
├── app/            # App Router routes — /login, /register, /boards, /boards/[id]
├── components/
│   ├── board/      # the board view: columns, cards, dnd-kit wiring
│   ├── boards/      # boards list / creation
│   └── ui/          # shared "Filing Room" primitives
└── lib/            # API client, rank math, optimistic cache transforms
```

## Architecture notes

- **Drag-and-drop** is built on `dnd-kit` with four settings that are each load-bearing, not
  defaults — `MeasuringStrategy.Always`, `closestCorners`, a mouse/touch sensor split, and no
  Framer Motion `layout` on sortable cards. See
  [DESIGN.md §6](DESIGN.md#6-drag-and-drop--the-contract).
- **Visual design** follows "Filing Room" (walnut desk, angle-cut manila tabs, ruled index cards):
  exact tokens, type scale, motion durations/easings, and the a11y and lightweight-budget
  constraints are all specified in [DESIGN.md](DESIGN.md). No styling, icon, or animation
  dependency is added beyond what's already listed there.
- **Auth** uses httpOnly cookies set by the backend — never `localStorage` — with the rewrite proxy
  above keeping the whole app same-origin.

The full endpoint table, sample env block, and Docker instructions live in the
[root README](../README.md) — this file covers only what's specific to running the frontend on its
own.
