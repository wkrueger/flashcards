# Deck Reorder — Design Spec

Date: 2026-06-04

## Overview

Allow users to reorder decks on the deck list page via drag-and-drop. Works on both mouse and touch (mobile). Order persists to the server.

## Library

`@dnd-kit/core` + `@dnd-kit/sortable` installed in `packages/client`. Pointer-sensor-based — single code path for mouse and touch. TypeScript-first, actively maintained.

## Data Layer

### Schema

Add `sortOrder Int @default(0)` to the `Deck` model in `packages/server/prisma/schema.prisma`. New Prisma migration.

Existing decks all receive `sortOrder = 0`. Until the user drags, ties are broken by `createdAt asc`.

### `decks.list` query

Change `orderBy` from `{ name: "asc" }` to `[{ sortOrder: "asc" }, { createdAt: "asc" }]`.

### `decks.reorder` mutation

New tRPC mutation on the `decksRouter`.

- Input: `reorderDecksInput` — `{ ids: string[] }` (full ordered list of the caller's deck IDs).
- Validates every ID in `ids` belongs to `ctx.user.id`; throws `BAD_REQUEST` if count mismatches.
- Runs `ctx.prisma.$transaction([...])` assigning `sortOrder = index` for each ID.
- Returns `{ ok: true }`.

## Shared Schema

Add to `packages/shared/src/Schemas.ts`:

```ts
export const reorderDecksInput = z.object({ ids: z.array(z.string()).min(1) })
```

Export from `packages/shared/src/index.ts`.

## Client

### `DeckListPage.tsx`

- Maintain local `items` state initialised from `decks.data` (reset when query refetches).
- Wrap `<ul>` in `<DndContext sensors={[pointerSensor]} onDragEnd={handleDragEnd}>` + `<SortableContext items={itemIds} strategy={verticalListSortingStrategy}>`.
- `handleDragEnd`: call `arrayMove` to reorder `items` optimistically, then fire `reorder.mutate({ ids })`. On mutation error, call `utils.decks.list.invalidate()` to revert from server truth.

### `SortableDeckItem` component

Inline component in `DeckListPage.tsx` (extract to `DeckListPage/SortableDeckItem.tsx` if total file exceeds 500 lines — per project convention, convert to `DeckListPage/` directory).

- Uses `useSortable(id)` hook.
- Renders a `GripVertical` (lucide-react) drag handle on the left with `{...attributes} {...listeners}`.
- The existing `<Link>` occupies the rest of the row — tapping it still navigates normally.
- Dragged item gets reduced opacity via `isDragging` from `useSortable`; position handled by the CSS `transform` from `useSortable`'s `style` — no separate `DragOverlay` needed for a simple vertical list.

## File Locations

| File | Change |
|---|---|
| `packages/shared/src/Schemas.ts` | Add `reorderDecksInput` |
| `packages/shared/src/index.ts` | Export `reorderDecksInput` |
| `packages/server/prisma/schema.prisma` | Add `sortOrder Int @default(0)` to `Deck` |
| `packages/server/src/domains/Decks/decksRouter.ts` | Update `list` orderBy; add `reorder` mutation |
| `packages/client/src/domains/Decks/DeckListPage.tsx` | DnD wiring + `SortableDeckItem` |
| `packages/client/package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable` |

## Testing

- New integration test in `packages/server/tests/domains/decks.test.ts`:
  - `decks.reorder` persists order (list returns decks in new order).
  - `decks.reorder` rejects IDs belonging to another user.
- `pnpm typecheck && pnpm lint && pnpm test` must stay green.
- No e2e change required.
