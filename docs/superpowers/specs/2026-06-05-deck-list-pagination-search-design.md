# Deck List — Pagination, Search & Fractional Reorder — Design Spec

Date: 2026-06-05

## Overview

The deck list (`DeckListPage`) currently loads every deck in one query and renders
them all. As a user accumulates decks this gets heavy, and there is no way to find
a deck by name. This work adds:

1. **Server-side pagination** — initial page of 30 decks, load more on scroll near the
   end (infinite scroll).
2. **Search** — a button in the page-header pill that expands into an input; filters
   decks by name server-side so it works across unloaded pages.
3. **Fractional (float) reorder** — replace the "rewrite every row" reorder with a
   float `sortOrder` so each drag edits a single row. Server computes the real
   neighbor (even if hidden by the current filter), so reorder stays correct while
   searching.

Decks-per-user is expected to stay modest; 100+ is rare. Designs favor simplicity
accordingly.

## Data Layer

### Schema

Change `Deck.sortOrder` from `Int @default(0)` to `Float @default(0)` in
`packages/server/prisma/schema.prisma`. New Prisma migration (`pnpm db:migrate`).
Existing integer values remain valid floats; no data backfill needed.

### `decks.list` — paginated + search

Replace the current no-input query with:

- **Input** (new shared schema `listDecksInput`):
  `{ cursor?: number (offset), limit?: number = 30, q?: string }`
- **Where**: `userId: ctx.user.id`, plus optional `name: { contains: q }` when `q`
  is non-empty. SQLite `LIKE` is case-insensitive for ASCII; Prisma `mode:
"insensitive"` is unsupported on SQLite, so plain `contains` is used.
- **Order**: `[{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]`.
- **Pagination**: offset-based. `skip: cursor ?? 0`, `take: limit + 1` to detect
  whether more remain. Return `{ items, nextCursor }` where `nextCursor` is the next
  offset, or `null` when exhausted.
- **dueCount**: still computed per returned row (same logic as today — sequential vs
  cooldown count). Only the page's rows (≤30) are counted per request.

Offset pagination is chosen over cursor pagination for simplicity given the small list
size. The mild risk of a duplicated/skipped row when a reorder happens mid-scroll is
low-stakes for decks.

### `decks.move` — fractional reorder (replaces `decks.reorder`)

- **Input** (new shared schema `moveDeckInput`, replaces `reorderDecksInput`):
  `{ id: string, afterId: string | null }`.
  `afterId` is the id of the visible deck the dragged deck was dropped **after**;
  `null` means dropped at the top.
- **Steps**:
  1. Load the moved deck and (if `afterId`) the anchor deck; both must belong to
     `ctx.user.id` (else `NOT_FOUND` / `BAD_REQUEST`).
  2. **Tie self-heal**: check whether the user's decks contain any duplicate
     `sortOrder`. If so, renormalize **all of the user's decks**: load them in the
     canonical order above and reassign `sortOrder = 0, 1, 2, …` in one transaction.
     This is the only N-row write and fires rarely (once post-migration when legacy
     rows all share `0`, or any time ties reappear). Re-read anchor/next from the
     normalized values afterward.
  3. Determine the **real** next deck after the anchor: the user's deck with the
     smallest `sortOrder` strictly greater than the anchor's (ordered asc, take 1) —
     this may be a deck hidden by the current search filter.
  4. Compute `newSortOrder`:
     - anchor + next → `(anchor.sortOrder + next.sortOrder) / 2`
     - anchor, no next (anchor is last) → `anchor.sortOrder + 1`
     - no anchor (dropped at top), list non-empty → `firstDeck.sortOrder - 1`
     - empty list → `0`
  5. Update the moved deck's `sortOrder` only (**single row**).
- Returns `{ ok: true }`.

**Precision caveat**: ~50 inserts into the _same_ gap exhausts double precision. Rare
for decks; the tie self-heal in step 2 also recovers from any collapse, so no separate
renormalization scheduler is added.

## Client

`packages/client/src/domains/Decks/DeckListPage.tsx`.

### Data fetching

- `trpc.decks.list.useQuery()` → `trpc.decks.list.useInfiniteQuery()`.
  `getNextPageParam: (lastPage) => lastPage.nextCursor`. Flatten `data.pages` into a
  single `items` array (still copied into local `useState` for optimistic drag).
- `q` (debounced search term) is part of the query input, so changing it resets the
  infinite query to page 1.
- **Infinite scroll**: an IntersectionObserver sentinel `<div>` near the list end calls
  `fetchNextPage()` when it enters the viewport and `hasNextPage` is true.

### Search UI

- A `Search`-icon `Button` (ghost, sm) in the `PageHeader` `actions`, beside "New deck".
- Clicking toggles an **expanding input** (animated width) with a clear/collapse
  affordance. Mobile-first, fits the `max-w-md` shell.
- Input value is debounced (~250ms) before becoming `q`.

### Drag-and-drop

- dnd-kit (`DndContext` / `SortableContext`) is unchanged. Because pagination keeps all
  loaded rows in the DOM (no windowing), dnd-kit operates normally — no
  unmount-while-dragging issue.
- On drop: compute `afterId = items[newIndex - 1]?.id ?? null` (the deck the dragged one
  now follows, excluding itself), optimistically reorder local `items`, then
  `move.mutate({ id, afterId })`. On settle, invalidate the list so the server's
  authoritative float position is reflected (a deck dropped while filtered may settle
  into its true position among hidden decks).
- Drag stays enabled while searching (per requirement); correctness comes from the
  server resolving the real neighbor.

### Empty states

Distinguish "No decks yet — create your first one." (no `q`) from "No decks match
'<q>'." (search active, zero results).

## Shared

`packages/shared/src/Schemas.ts`:

- Add `listDecksInput`.
- Replace `reorderDecksInput` with `moveDeckInput`.

## Testing & QA (project quality gates)

- `pnpm typecheck` and `pnpm lint` (client) — must stay green.
- **Vitest** (`packages/server/tests/domains`):
  - `decks.list` returns a first page of ≤`limit`, exposes `nextCursor`, and the next
    page continues correctly.
  - `q` filters by name (case-insensitive ASCII) and spans pages.
  - Per-user scoping for both `list` and `move`.
  - `decks.move` math: midpoint between two neighbors, append at end, insert at top,
    **hidden-neighbor** (anchor's real next is filtered out yet still used), and the
    tie self-heal path (all-zero legacy rows get normalized then moved).
  - Replace the existing `decks.reorder` tests.
- **Playwright** (`e2e/happy-path.spec.ts`): existing happy path stays green; add a
  light assertion that the search button toggles the input.
- `pnpm db:migrate` to apply the `Float` migration; `pnpm db:seed` unaffected.
