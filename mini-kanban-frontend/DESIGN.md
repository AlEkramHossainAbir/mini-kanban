# Filing Room — frontend design system

The chosen visual direction for the Mini Kanban board, approved 2026-09-04. This file is the
**source of truth for every UI decision** in `mini-kanban-frontend/`. Where it disagrees with a
memory, a habit, or a "nicer idea", this file wins. Where it is silent, follow
[`PLAN_EN.md`](../PLAN_EN.md) §6.

**Visual reference:** [`design/filing-room.reference.html`](design/filing-room.reference.html) —
a self-contained working mockup. Open it in a browser before writing any board UI. It is a
*look-and-feel* reference, not an implementation reference: its hand-rolled drag engine exists
only because an artifact cannot install `dnd-kit`. **Do not port that engine.** §6 explains what
to build instead.

**Concept.** A filing cabinet. Columns are manila folders with angle-cut tabs; tasks are ruled
index cards with a red header rule; the board sits on a walnut desk. Status lives in the *tab*
colour, not on the card. The metaphor is the reason the design doesn't look generic — keep it
consistent or drop it entirely, never half.

---

## 1. Scope and rules of engagement

- Every colour, size, radius, duration and easing in this file is **exact**. Do not round them,
  "improve" them, or substitute a Tailwind default (`rounded-lg`, `shadow-md`, `gray-500`).
- Everything here is CSS + Tailwind. **No new dependency** may be added for styling or animation
  beyond what frontend ROADMAP Phase 1 already lists.
- If a screen isn't described here (login, boards list, modals), derive it from these tokens:
  walnut ground, manila chrome, index-card surfaces, the same type roles, the same motion table.

---

## 2. Tokens

Paste into `src/app/globals.css`, replacing the scaffold's `:root` block. Single theme — the
board is a physical desk, it does not invert. Do **not** add a `prefers-color-scheme` block.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root{
  /* desk */
  --wood:#5E4736; --wood-hi:#6E5541; --wood-lo:#4A382B;
  /* folders + tabs */
  --manila:#D7C097; --manila-2:#C7AE83; --manila-ink:#4A3A22;
  /* index cards */
  --card:#FDFBF4; --card-2:#F6F1E4; --edge:#E0D6BE;
  /* text on paper */
  --ink:#231F1A; --pencil:#5D5449; --faint:#7C7365;
  /* hairlines only, never text */
  --hair:rgba(35,31,26,.09);
  /* accents */
  --rule:#B24234;   /* red header rule, errors, blocked, overdue */
  --blue:#2F5C86;   /* primary action, links, undo */
  --moss:#4A6B3C;   /* done, success */
  --amber:#8A6414;  /* in progress, warnings */
  /* motion */
  --ease:cubic-bezier(.22,.85,.28,1);
  --ease-settle:cubic-bezier(.16,1.24,.4,1);
}

body{
  color:var(--ink);
  background:
    radial-gradient(1100px 640px at 16% -12%, var(--wood-hi), transparent 58%),
    radial-gradient(900px 620px at 92% 112%, var(--wood-lo), transparent 60%),
    repeating-linear-gradient(88deg, rgba(255,255,255,.018) 0 3px, rgba(0,0,0,.014) 3px 7px),
    var(--wood);
  background-attachment:fixed;
}
```

> **`--faint` is `#7C7365`, not the mockup's `#8E8578`.** The mockup fails WCAG AA on small meta
> text; this value passes at 4.5:1 on `--card`. Use `--faint` for ≥11px secondary labels,
> `--pencil` for anything a user must read, `--hair` for rules and borders — **never** for text.

Tailwind mapping — `tailwind.config.ts`:

```ts
theme: {
  extend: {
    colors: {
      wood:{DEFAULT:"var(--wood)",hi:"var(--wood-hi)",lo:"var(--wood-lo)"},
      manila:{DEFAULT:"var(--manila)","2":"var(--manila-2)",ink:"var(--manila-ink)"},
      card:{DEFAULT:"var(--card)","2":"var(--card-2)",edge:"var(--edge)"},
      ink:"var(--ink)", pencil:"var(--pencil)", faint:"var(--faint)",
      rule:"var(--rule)", blue:"var(--blue)", moss:"var(--moss)", amber:"var(--amber)",
    },
    borderRadius:{card:"3px", tray:"0 8px 6px 6px", tab:"7px 12px 0 0"},
    boxShadow:{
      card:"0 1px 0 rgba(255,255,255,.8) inset, 0 3px 6px -3px rgba(20,14,8,.5)",
      lift:"0 28px 46px -18px rgba(18,12,6,.66), 0 7px 15px -6px rgba(18,12,6,.45)",
      tray:"0 12px 26px -18px rgba(0,0,0,.7)",
      toast:"0 18px 34px -14px rgba(8,5,3,.7)",
    },
    transitionTimingFunction:{paper:"cubic-bezier(.22,.85,.28,1)", settle:"cubic-bezier(.16,1.24,.4,1)"},
  },
}
```

---

## 3. Type

Two families, loaded through `next/font/google` in `src/app/layout.tsx` — **not** a `<link>` tag
and **not** a third family.

```ts
import { Archivo, Courier_Prime } from "next/font/google";
export const archivo = Archivo({ subsets:["latin"], weight:["400","500","600","700"],
  display:"swap", variable:"--font-archivo" });
export const courier = Courier_Prime({ subsets:["latin"], weight:["400","700"],
  display:"swap", variable:"--font-courier" });
```

| Role | Family | Size / line-height | Weight | Tracking | Colour |
|---|---|---|---|---|---|
| Card title | Courier Prime | 13px / **21px** | 700 | 0 | `--ink` |
| Card "filed" label | Courier Prime | 9.5px | 700 | .14em, uppercase | by kind (§4.4) |
| Card meta (`due Sep 6`) | Courier Prime | 11px | 400 | 0 | `--faint` |
| Column tab | Archivo | 11px | 700 | .12em, uppercase | `--manila-ink` |
| Page H1 | Archivo | 32px / 1.1 | 700 | −.022em | `#F6EFE3` |
| Sub-line under H1 | Courier Prime | 12.5px | 400 | 0 | `rgba(255,240,220,.6)` |
| Buttons, inputs, chrome | Archivo | 12.5–14px | 600 / 400 | 0 | per surface |
| Figures (counts, stats) | Archivo | 18px | 700 | tabular-nums | `--manila-ink` |

The **21px card line-height is load-bearing** — it matches the ruled-line spacing in §4.4. Change
one and you change both.

---

## 4. Components

### 4.1 Board shell
Horizontal strip: `display:flex; gap:14px; overflow-x:auto`, its **own** scroll container, never
the page's (PLAN §6 — this is what stops mobile swipe fighting the drag). Column width `280px`,
`flex:0 0 280px`. Page padding `0 30px`, max width `1420px`.

### 4.2 Column tab
```css
align-self:flex-start;
background:linear-gradient(var(--manila),var(--manila-2));
border-radius:7px 12px 0 0; padding:7px 20px 6px 14px;
clip-path:polygon(0 0, calc(100% - 11px) 0, 100% 100%, 0 100%);
box-shadow:0 -1px 0 rgba(255,255,255,.4) inset;
```
Status colour lives here and nowhere else:

| Column | Tab gradient |
|---|---|
| Backlog, In review | `var(--manila)` → `var(--manila-2)` |
| In progress | `#E0C793` → `#CFB37C` |
| Blocked | `#DBB6A4` → `#C99C87` |
| Done | `#C4CDA8` → `#AEB98E` |

Tab holds: name (Archivo 700 uppercase) + count. **The count is `tasks.length`, derived at render** —
never a stored counter.

### 4.3 Tray (the folder body)
```css
position:relative; /* required: cards are measured against it */
background:linear-gradient(rgba(215,192,151,.26),rgba(215,192,151,.16));
border:1px solid rgba(255,255,255,.22);
border-radius:0 8px 6px 6px;   /* square top-left, tucked under the tab */
padding:12px; display:flex; flex-direction:column; gap:11px;
min-height:218px; box-shadow:0 12px 26px -18px rgba(0,0,0,.7);
```
Drop-target state (`is-over`): background lightens to
`linear-gradient(rgba(240,222,186,.4),rgba(240,222,186,.26))`, border to `rgba(255,255,255,.42)`,
200ms. **The whole tray is the droppable**, including when it holds zero cards.

Empty tray: a dashed inset reading `no cards filed`, Courier Prime 12px,
`rgba(255,247,230,.6)`, `1.5px dashed rgba(255,247,230,.34)`, height 78px.

### 4.4 Index card
```css
position:relative; border:1px solid var(--edge); border-radius:3px;
padding:29px 13px 11px;               /* 29px top clears the label + red rule */
background-color:var(--card);
background-image:
  linear-gradient(rgba(178,66,52,.5) 0 1px, transparent 1px),                 /* red header rule */
  repeating-linear-gradient(rgba(47,92,134,.08) 0 1px, transparent 1px 21px); /* ruled lines */
background-position:0 22px, 0 24px;
background-repeat:no-repeat, repeat;
box-shadow:0 1px 0 rgba(255,255,255,.8) inset, 0 3px 6px -3px rgba(20,14,8,.5);
```
Anatomy, top to bottom: `filed` label (absolute, `left:13px; top:5px`) → red rule → title →
hairline → meta row (`due …` left, 20px round avatar right, `margin-left:auto`).

Kind colours apply **only to the `filed` label**: `dnd` → `--amber`, `risk`/`security` →
`--rule`, `api`/`realtime` → `--blue`, `ship`/`infra` → `--moss`, default `--faint`.

`overdue` stamp: absolutely positioned `right:8px; top:-8px`, `rotate(-4deg)`, Courier Prime
9.5px/700, `--rule` text on `--card` inside a `1.5px` `--rule` border.

Done card: `opacity:.7`, title `line-through` at `rgba(35,31,26,.32)`, weight 400.

### 4.5 Toast (sonner)
Manila slip, `border-radius:2px`, `border-left:3px solid var(--blue)` (error: `--rule`, on
`#E7C6B8`), `box-shadow:0 18px 34px -14px rgba(8,5,3,.7)`, bottom-right, Archivo 600 13px.
Action label (`Undo`) is `--blue` 700, underline on hover. Enter 300ms `--ease` from
`translate3d(20px,0,0) rotate(1.4deg)`; exit 200ms opacity only.

### 4.6 Buttons
Desk buttons (on wood): `rgba(255,255,255,.11)` fill, `1px solid rgba(255,255,255,.2)`, 3px
radius, 31px tall; hover lifts 1px and brightens fill. Primary: solid `--manila` with
`--manila-ink` text and `0 2px 0 rgba(0,0,0,.22)`. Paper buttons (inside cards/modals): `--card`
fill, `--edge` border, `--ink` text.

### 4.7 Skeletons
Card-shaped: `--card-2` fill, the same 3px radius and ruled background, `animate-pulse`.
Column-shaped: tab + tray outline with three card skeletons. Never a spinner on the board.

---

## 5. Motion

| What | Duration | Easing | Property |
|---|---|---|---|
| Hover lift (card, button) | 200ms | `--ease` | `transform` only |
| Hover shadow bloom | 200ms | `--ease` | `opacity` of a shadow layer |
| Reflow — cards making room | **280ms** | `--ease` | `transform` |
| Drop settle | **340ms** | `--ease-settle` | `transform` |
| Tray drop-target tint | 200ms | `--ease` | `background`, `border-color` |
| Toast in / out | 300 / 200ms | `--ease` | `transform`, `opacity` |
| Conflict flash | 760ms | `--ease` | `box-shadow` (one-shot, not a transition) |
| Skeleton pulse | 1.6s | linear | `opacity` |

**Drag character:** the lifted card scales to **1.05** and tilts up to **±6°** proportional to
horizontal pointer velocity. This is the whole personality of the direction — a card leaves the
folder, tips, and settles. Everything else stays quiet.

Three rules that are not negotiable, because breaking them is exactly what made the first
prototype feel cheap:

1. **Only `transform` and `opacity` animate.** Never transition `box-shadow`, `width`, `height`,
   `top`/`left`, `background-position` or `filter`. A lifting card gets a second absolutely
   positioned shadow layer (`::after`, `inset:0`, `pointer-events:none`) whose **opacity** goes
   `0 → .45` on hover and `→ 1` while dragging.
2. **`will-change:transform` only while an element is actually dragging**, applied on drag start
   and removed on drop. Leaving it on every card creates one compositor layer per card.
3. **`prefers-reduced-motion: reduce` kills tilt, scale and overshoot**, and collapses reflow and
   drop to ≤1ms. Opacity fades may stay, capped at 100ms.

---

## 6. Drag and drop — the contract

**Build this on `dnd-kit`.** It is already a Phase 1 dependency, it is keyboard-accessible, and
PLAN §6 chose it deliberately. The reference mockup's rAF drag engine is *not* the target
architecture; it exists only because an artifact can't install packages. Hand-rolling drag in the
real app would forfeit the keyboard sensor, the announcements, and the sensor-activation
behaviour the assessment grades.

But the four bugs that made the first mockup feel rough are real, and each has a `dnd-kit`
equivalent that must be configured explicitly — none of them is the default:

| Failure in the naive build | What it looks like | Required configuration |
|---|---|---|
| Measuring droppables once, at drag start | The gap opens in the wrong place after the first reorder | `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` on `DndContext` |
| Distance-to-centre collisions with variable card heights | Card refuses to land in a tall neighbour's slot; empty columns are unreachable | `collisionDetection={closestCorners}` |
| Two animation systems on one node | Cards judder, drop lands off by a few pixels | `useSortable`'s own `transform`/`transition` drives the reflow. **Never put Framer Motion's `layout` prop on a sortable card.** |
| Layout-affecting styles during drag | Frame drops on boards with many cards | The dragged card renders in a `DragOverlay`; the source card stays in flow at `opacity:.4` as the placeholder |

Required `DndContext` shape:

```tsx
const sensors = useSensors(
  useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
```

> **Mouse and touch are split deliberately**, refining the single `PointerSensor` in ROADMAP
> Phase 7. A 200ms delay is required on touch so a vertical scroll isn't read as a drag — but the
> same delay on a mouse makes every drag feel 200ms late, which reads as lag, not as polish.
> Distance-4 on mouse starts instantly while still allowing a click to open a card.

Also required:

- `<SortableContext items={taskIds} strategy={verticalListSortingStrategy}>` per column, and the
  tray itself registered with `useDroppable` so an **empty column is a valid target** (PLAN §6).
- `DragOverlay` renders the lifted card with `scale(1.05)` and the velocity tilt. Get the tilt by
  tracking pointer X in a `rAF` loop and writing a `--tilt` CSS custom property on the overlay
  child — **not** by returning a rotated transform from a modifier, which fights dnd-kit's own
  positioning and causes the card to drift from the cursor.
- `dropAnimation={{ duration: 340, easing: 'cubic-bezier(.16,1.24,.4,1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}`.
- `autoScroll` left on (dnd-kit's default) for both the horizontal strip and vertical trays.
- `onDragEnd` sends **neighbour ids**, never an index (PLAN §3).

Render-cost rules for a board that stays at 60fps:

- `TaskCard` is `React.memo`'d, compared on `id`, `rank`, `version`, `title`, `assigneeId`.
- `activeId` state lives in the component that owns `DndContext`; a card must not subscribe to it,
  or every card re-renders on every drag frame.
- Each `Column` selects its own slice of the query cache — no component subscribes to the whole
  board while a drag is in flight (PLAN §6).
- Nothing in the drag path calls `getBoundingClientRect()` per frame. `MeasuringStrategy.Always`
  is dnd-kit's own, batched equivalent; a second hand-rolled measurement pass is a bug.

---

## 7. Accessibility

- Contrast: `--ink`/`--pencil`/`--faint` on `--card` all clear 4.5:1. Manila-ink on manila clears
  it too. Check any new pairing before shipping it.
- Focus: 2px `--manila` ring at 3px offset on the wood ground; 2px `--blue` on paper surfaces.
  Never remove an outline without replacing it.
- Keyboard drag is a graded requirement: Tab to a card, Space/Enter to lift, arrows to move,
  Space/Enter to drop, Esc to cancel, with `announcements` naming task, column and position
  ("Task 'Rate-limit auth routes per IP' moved to Blocked, position 2 of 4").
- Tap targets ≥ 44px on touch; the card itself is the drag handle, so no small grip affordance.
- Kind is never signalled by colour alone — the `filed` label always carries the word.

---

## 8. Lightweight budget

- No animation library beyond `framer-motion`, and `framer-motion` is used **only** for card
  enter/exit and toast/modal transitions — never on a sortable card (§6).
- Card ruling, tabs, desk grain and shadows are CSS gradients. **Zero images**, zero SVG filters.
- Two font families, six weights total, `display:swap`, latin subset.
- `lucide-react` icons imported individually.
- Target: the `/boards/[id]` route ships **< 200KB gzipped JS**. Check with `npm run build`
  before calling the UI done.

---

## 9. Done when

- [ ] Side-by-side with `design/filing-room.reference.html`, the board reads as the same product.
- [ ] Dragging a card across four columns and back, fast, twenty times: no jump-back, no
      duplicate, no card left behind, gap never flickers between two slots.
- [ ] A card drops into the **empty** Blocked column, by mouse and by keyboard.
- [ ] A 409 from the server rolls the card back with the flash and the error toast; a successful
      cross-column move offers Undo for 5s and the undo lands the card where it started.
- [ ] With 60 cards in one column, dragging holds 60fps in a Performance recording (no layout
      thrash, no per-frame style recalc on non-dragged cards).
- [ ] Touch: vertical scroll inside a tray and horizontal swipe across the board both work
      without starting a drag; a 200ms press does start one.
- [ ] `prefers-reduced-motion: reduce` removes tilt, scale and overshoot; the board is still fully
      usable.
- [ ] Keyboard drag announces every move; focus is visible on every interactive element.
- [ ] `npm run build` reports the board route under the §8 budget.
