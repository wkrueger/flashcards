# Deck List Pagination, Search & Fractional Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side pagination + name search to the deck list, and replace the rewrite-every-row reorder with a single-row fractional (float) `sortOrder` move.

**Architecture:** `decks.list` becomes an offset-paginated, name-filtered tRPC query returning `{ items, nextCursor }`; the client consumes it via `useInfiniteQuery` with an IntersectionObserver sentinel. `decks.reorder` is replaced by `decks.move({ id, afterId })` which self-heals tied `sortOrder`s, finds the real (possibly filtered-out) next neighbor in memory, and writes the midpoint to one row. A `Search` button in the page-header pill expands into a debounced input.

**Tech Stack:** Fastify + tRPC + Prisma (SQLite) server; React 18 + TanStack Query + dnd-kit client; Vitest + Playwright.

> **Project commit convention (memory `feedback_no_commits_during_impl`):** Do **NOT** run `git commit`. Leave all changes in the working tree; the user commits themselves. Each task ends with a verification step instead of a commit.

---

## File Structure

- `packages/server/prisma/schema.prisma` — `Deck.sortOrder` Int → Float (+ migration).
- `packages/shared/src/Schemas.ts` — add `listDecksInput`, replace `reorderDecksInput` with `moveDeckInput`.
- `packages/server/src/domains/Decks/decksRouter.ts` — paginate+search `list`; replace `reorder` with `move`.
- `packages/server/tests/domains/Decks.test.ts` — update `list` call sites, replace `reorder` tests with `move` tests.
- `packages/client/src/domains/Decks/DeckSearch.tsx` — new expanding search component.
- `packages/client/src/domains/Decks/DeckListPage.tsx` — infinite query, sentinel, search wiring, `move` mutation.
- `packages/client/e2e/happy-path.spec.ts` — light search-toggle assertion.

---

## Task 1: Schema — float sortOrder + shared schemas

**Files:**

- Modify: `packages/server/prisma/schema.prisma:110`
- Modify: `packages/shared/src/Schemas.ts:34-36`

- [ ] **Step 1: Change the column type**

In `packages/server/prisma/schema.prisma`, line 110, change:

```prisma
  sortOrder                Int                    @default(0)
```

to:

```prisma
  sortOrder                Float                  @default(0)
```

- [ ] **Step 2: Generate + apply the migration**

Run: `pnpm --filter server exec prisma migrate dev --name deck_sortorder_float`
Expected: a new folder under `packages/server/prisma/migrations/` and "Your database is now in sync". Prisma client regenerates.

- [ ] **Step 3: Replace deck schemas in shared**

In `packages/shared/src/Schemas.ts`, replace lines 34-36 (the `reorderDecksInput` block) with:

```ts
export const listDecksInput = z.object({
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  q: z.string().max(100).optional(),
})

export const moveDeckInput = z.object({
  id: z.string().min(1).max(64),
  afterId: z.string().min(1).max(64).nullable(),
})
```

Confirm both are re-exported from `packages/shared/src/index.ts` (the file re-exports everything from `Schemas`; if it lists names explicitly, add `listDecksInput` and `moveDeckInput`, remove `reorderDecksInput`).

Run: `grep -n "reorderDecksInput\|listDecksInput\|moveDeckInput" packages/shared/src/index.ts`
Expected: no `reorderDecksInput`; both new names present (or a blanket `export * from "./Schemas"`).

- [ ] **Step 4: Verify shared + schema typecheck**

Run: `pnpm --filter @cards/shared typecheck` (or `pnpm typecheck`)
Expected: PASS for shared. The server will still fail to typecheck because `decksRouter.ts` imports `reorderDecksInput` — fixed in Task 3. Leave it for now.

---

## Task 2: Server — paginate + search `decks.list`

**Files:**

- Modify: `packages/server/src/domains/Decks/decksRouter.ts:2,32-66`
- Test: `packages/server/tests/domains/Decks.test.ts`

- [ ] **Step 1: Write failing tests for pagination + search**

In `packages/server/tests/domains/Decks.test.ts`, the existing isolation test calls `decks.list()` and treats the result as an array (lines 19-23). Update those two reads and add a new `describe`. First, fix the existing array reads:

Replace lines 19-23:

```ts
const aDecks = await callerFor(a).decks.list()
const bDecks = await callerFor(b).decks.list()
expect(aDecks).toHaveLength(1)
expect(bDecks).toHaveLength(1)
expect(aDecks[0]!.id).not.toBe(bDecks[0]!.id)
```

with:

```ts
const aDecks = (await callerFor(a).decks.list({})).items
const bDecks = (await callerFor(b).decks.list({})).items
expect(aDecks).toHaveLength(1)
expect(bDecks).toHaveLength(1)
expect(aDecks[0]!.id).not.toBe(bDecks[0]!.id)
```

Find the other `decks.list()` read (around line 237) and wrap it the same way: `const list = (await trpc.decks.list({})).items`.

Then add this block before the final closing `})` of the top-level `describe`:

```ts
describe("list pagination + search", () => {
  it("paginates with nextCursor", async () => {
    const u = await makeUser("pg")
    const caller = callerFor(u)
    for (let i = 0; i < 5; i++) await caller.decks.create({ name: `Deck ${i}` })

    const page1 = await caller.decks.list({ limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).toBe(2)

    const page2 = await caller.decks.list({ limit: 2, cursor: page1.nextCursor! })
    expect(page2.items).toHaveLength(2)
    expect(page2.nextCursor).toBe(4)

    const page3 = await caller.decks.list({ limit: 2, cursor: page2.nextCursor! })
    expect(page3.items).toHaveLength(1)
    expect(page3.nextCursor).toBeNull()
  })

  it("filters by name (case-insensitive), spanning the whole list", async () => {
    const u = await makeUser("se")
    const caller = callerFor(u)
    await caller.decks.create({ name: "German A1" })
    await caller.decks.create({ name: "German A2" })
    await caller.decks.create({ name: "French Basics" })

    const res = await caller.decks.list({ q: "german" })
    expect(res.items.map((d) => d.name).sort()).toEqual(["German A1", "German A2"])
    expect(res.nextCursor).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter server test -- Decks`
Expected: FAIL — `decks.list` does not accept input / `.items` is undefined.

- [ ] **Step 3: Implement paginated + searchable `list`**

In `packages/server/src/domains/Decks/decksRouter.ts`, update the imports on line 2 to pull in the new schema (remove `reorderDecksInput`, add `listDecksInput` and `moveDeckInput`):

```ts
import {
  createDeckInput,
  idInput,
  listDecksInput,
  moveDeckInput,
  updateDeckInput,
} from "@cards/shared"
```

Replace the entire `list:` procedure (lines 32-66) with:

```ts
  list: protectedProcedure.input(listDecksInput).query(async ({ ctx, input }) => {
    const now = new Date()
    const limit = input.limit ?? 30
    const offset = input.cursor ?? 0
    const q = input.q?.trim()
    const where = {
      userId: ctx.user.id,
      ...(q ? { name: { contains: q } } : {}),
    }
    const rows = await ctx.prisma.deck.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const dueCounts = await Promise.all(
      page.map((d) =>
        // Sequential decks progress through unseen subjects in order, so the
        // "to do" count is the number of subjects not yet seen rather than the
        // number whose cooldown has elapsed.
        d.sequentialEnabled
          ? ctx.prisma.subject.count({
              where: { userId: ctx.user.id, deckId: d.id, firstSeenAt: null },
            })
          : ctx.prisma.subject.count({
              where: { userId: ctx.user.id, deckId: d.id, cooldownAt: { lte: now } },
            })
      )
    )
    return {
      items: page.map((d, i) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        dueCount: dueCounts[i] ?? 0,
      })),
      nextCursor: hasMore ? offset + limit : null,
    }
  }),
```

- [ ] **Step 4: Run tests, verify pagination/search pass**

Run: `pnpm --filter server test -- Decks`
Expected: the two new tests PASS and the updated isolation test PASS. The old `reorder` tests still FAIL (procedure not yet replaced) — fixed in Task 3.

---

## Task 3: Server — replace `reorder` with fractional `move`

**Files:**

- Modify: `packages/server/src/domains/Decks/decksRouter.ts:278-290`
- Test: `packages/server/tests/domains/Decks.test.ts:289-310`

- [ ] **Step 1: Write failing tests for `move`**

In `packages/server/tests/domains/Decks.test.ts`, replace the entire existing `describe("reorder", ...)` block (around lines 289-310) with:

```ts
describe("move", () => {
  async function orderedNames(caller: ReturnType<typeof callerFor>) {
    return (await caller.decks.list({ limit: 100 })).items.map((d) => d.name)
  }

  it("drops a deck after an anchor using the midpoint of real neighbors", async () => {
    const u = await makeUser("mv")
    const caller = callerFor(u)
    const a = await caller.decks.create({ name: "A" })
    const b = await caller.decks.create({ name: "B" })
    const c = await caller.decks.create({ name: "C" })
    // start order: A, B, C — move C to after A → A, C, B
    await caller.decks.move({ id: c.id, afterId: a.id })
    expect(await orderedNames(caller)).toEqual(["A", "C", "B"])
  })

  it("dropping at the top (afterId null) puts the deck first", async () => {
    const u = await makeUser("mvtop")
    const caller = callerFor(u)
    await caller.decks.create({ name: "A" })
    await caller.decks.create({ name: "B" })
    const c = await caller.decks.create({ name: "C" })
    await caller.decks.move({ id: c.id, afterId: null })
    expect(await orderedNames(caller)).toEqual(["C", "A", "B"])
  })

  it("dropping after the last deck keeps it last", async () => {
    const u = await makeUser("mvend")
    const caller = callerFor(u)
    const a = await caller.decks.create({ name: "A" })
    const b = await caller.decks.create({ name: "B" })
    const c = await caller.decks.create({ name: "C" })
    // move A after C → B, C, A
    await caller.decks.move({ id: a.id, afterId: c.id })
    expect(await orderedNames(caller)).toEqual(["B", "C", "A"])
  })

  it("uses the real next neighbor even when it is hidden by a search filter", async () => {
    const u = await makeUser("mvhidden")
    const caller = callerFor(u)
    // Order: Apple, Banana, Cherry, Date. User searches "a" (Apple, Banana, Date
    // visible; Cherry hidden) and drops Date after Apple. Date must land between
    // Apple and Banana (the real next), i.e. before the hidden Cherry too.
    const apple = await caller.decks.create({ name: "Apple" })
    await caller.decks.create({ name: "Banana" })
    await caller.decks.create({ name: "Cherry" })
    const date = await caller.decks.create({ name: "Date" })
    await caller.decks.move({ id: date.id, afterId: apple.id })
    expect(await orderedNames(caller)).toEqual(["Apple", "Date", "Banana", "Cherry"])
  })

  it("self-heals tied sortOrders before moving", async () => {
    const u = await makeUser("mvtie")
    const caller = callerFor(u)
    const a = await caller.decks.create({ name: "A" })
    const b = await caller.decks.create({ name: "B" })
    const c = await caller.decks.create({ name: "C" })
    // Force a legacy all-zero tie directly in the DB.
    await prisma.deck.updateMany({ where: { userId: u }, data: { sortOrder: 0 } })
    // Move C after A; tie-heal first (A=0,B=1,C=2 by createdAt), then C→1.5 → A,C,B
    await caller.decks.move({ id: c.id, afterId: a.id })
    expect(await orderedNames(caller)).toEqual(["A", "C", "B"])
  })

  it("rejects moving another user's deck", async () => {
    const u1 = await makeUser("o1")
    const u2 = await makeUser("o2")
    const deck = await callerFor(u1).decks.create({ name: "Mine" })
    await expect(callerFor(u2).decks.move({ id: deck.id, afterId: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter server test -- Decks`
Expected: FAIL — `decks.move` does not exist.

- [ ] **Step 3: Implement `move` (replace `reorder`)**

In `packages/server/src/domains/Decks/decksRouter.ts`, replace the entire `reorder:` procedure (lines 278-290) with:

```ts
  move: protectedProcedure.input(moveDeckInput).mutation(async ({ ctx, input }) => {
    const moved = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true },
    })
    if (!moved) throw new TRPCError({ code: "NOT_FOUND" })

    // Load all of the user's decks in canonical order (unfiltered, so the "real"
    // next neighbor is found even when the client is showing a search subset).
    const all = await ctx.prisma.deck.findMany({
      where: { userId: ctx.user.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sortOrder: true },
    })

    // Tie self-heal: if any two decks share a sortOrder, renormalize ALL of the
    // user's decks to 0,1,2,... in one transaction before computing the move.
    const tied = new Set(all.map((d) => d.sortOrder)).size !== all.length
    if (tied) {
      await ctx.prisma.$transaction(
        all.map((d, i) => ctx.prisma.deck.update({ where: { id: d.id }, data: { sortOrder: i } }))
      )
      all.forEach((d, i) => (d.sortOrder = i))
    }

    let anchorOrder: number | null = null
    if (input.afterId) {
      const anchor = all.find((d) => d.id === input.afterId)
      if (!anchor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid anchor." })
      anchorOrder = anchor.sortOrder
    }

    let newOrder: number
    if (anchorOrder === null) {
      const first = all.find((d) => d.id !== input.id)
      newOrder = first ? first.sortOrder - 1 : 0
    } else {
      const next = all.find((d) => d.sortOrder > anchorOrder! && d.id !== input.id)
      newOrder = next ? (anchorOrder + next.sortOrder) / 2 : anchorOrder + 1
    }

    await ctx.prisma.deck.update({ where: { id: input.id }, data: { sortOrder: newOrder } })
    return { ok: true }
  }),
```

- [ ] **Step 4: Run the full server suite**

Run: `pnpm --filter server test -- Decks`
Expected: all `move` tests PASS, all `list` tests PASS.

- [ ] **Step 5: Server typecheck**

Run: `pnpm --filter server typecheck`
Expected: PASS (no remaining `reorderDecksInput` references).

---

## Task 4: Client — `DeckSearch` expanding input component

**Files:**

- Create: `packages/client/src/domains/Decks/DeckSearch.tsx`

- [ ] **Step 1: Create the component**

Create `packages/client/src/domains/Decks/DeckSearch.tsx`:

```tsx
import { Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../ui/Button"

export function DeckSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function close() {
    setOpen(false)
    onChange("")
  }

  return (
    <div className="flex items-center">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && close()}
        placeholder="Search decks"
        aria-label="Search decks"
        className={`h-7 rounded-full bg-transparent text-xs outline-none transition-all duration-200 ${
          open ? "w-32 px-2 opacity-100" : "w-0 px-0 opacity-0"
        }`}
        tabIndex={open ? 0 : -1}
      />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 px-2"
        aria-label={open ? "Close search" : "Search decks"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the client**

Run: `pnpm --filter client typecheck`
Expected: PASS (component compiles; not yet used, but no errors).

---

## Task 5: Client — infinite query, sentinel, search & move wiring

**Files:**

- Modify: `packages/client/src/domains/Decks/DeckListPage.tsx`

- [ ] **Step 1: Update imports**

In `packages/client/src/domains/Decks/DeckListPage.tsx`, change the lucide import (line 20) to drop nothing but add `useRef`/`useMemo` from react (line 21). Replace line 21:

```ts
import { useEffect, useState } from "react"
```

with:

```ts
import { useEffect, useMemo, useRef, useState } from "react"
```

Add the `DeckSearch` import next to the `LanguageSelect` import (line 30):

```ts
import { DeckSearch } from "./DeckSearch"
```

- [ ] **Step 2: Replace the query + mutation setup**

Replace the body from `const decksQuery = trpc.decks.list.useQuery()` through the `reorder` mutation definition (lines 77-80) with:

```ts
const [rawQuery, setRawQuery] = useState("")
const [query, setQuery] = useState("")
useEffect(() => {
  const id = setTimeout(() => setQuery(rawQuery.trim()), 250)
  return () => clearTimeout(id)
}, [rawQuery])

const decksQuery = trpc.decks.list.useInfiniteQuery(
  { q: query || undefined, limit: 30 },
  { getNextPageParam: (last) => last.nextCursor }
)
const move = trpc.decks.move.useMutation({
  onSettled: () => utils.decks.list.invalidate(),
})
```

- [ ] **Step 3: Derive items from pages**

Replace the `const [items, setItems] = useState<DeckItem[]>([])` line (line 90) — keep it, but replace the sync effect (lines 98-100) with a flatten + sync:

```ts
const flatItems = useMemo<DeckItem[]>(
  () => decksQuery.data?.pages.flatMap((p) => p.items) ?? [],
  [decksQuery.data]
)
useEffect(() => {
  setItems(flatItems)
}, [flatItems])
```

- [ ] **Step 4: Update the loading flag references**

The code reads `decksQuery.isLoading` (lines 103, 244). `useInfiniteQuery` still exposes `isLoading`, so no change needed. Verify by leaving those as-is.

- [ ] **Step 5: Add an infinite-scroll sentinel ref + observer**

After the `move` mutation setup, add:

```ts
const sentinelRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  const el = sentinelRef.current
  if (!el) return
  const obs = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && decksQuery.hasNextPage && !decksQuery.isFetchingNextPage) {
      decksQuery.fetchNextPage()
    }
  })
  obs.observe(el)
  return () => obs.disconnect()
}, [decksQuery.hasNextPage, decksQuery.isFetchingNextPage, decksQuery.fetchNextPage])
```

- [ ] **Step 6: Rewrite `handleDragEnd` to send `move`**

Replace the body of `handleDragEnd` (the `setItems((prev) => { ... })` block, lines 133-139) with:

```ts
const { active, over } = event
if (!over || active.id === over.id) return
setItems((prev) => {
  const oldIndex = prev.findIndex((d) => d.id === active.id)
  const newIndex = prev.findIndex((d) => d.id === over.id)
  const next = arrayMove(prev, oldIndex, newIndex)
  const movedIndex = next.findIndex((d) => d.id === active.id)
  const afterId = movedIndex > 0 ? next[movedIndex - 1]!.id : null
  move.mutate({ id: String(active.id), afterId })
  return next
})
```

- [ ] **Step 7: Add the search button to the header actions**

In the `PageHeader` `actions` prop, add `<DeckSearch>` before the `<Dialog>` (just inside the opening `<>` on line 147):

```tsx
<DeckSearch value={rawQuery} onChange={setRawQuery} />
```

- [ ] **Step 8: Distinguish empty states + render the sentinel**

Replace the empty-state paragraph (lines 274-278) and add the sentinel after the `</DndContext>`. The list-render branch ends at `</DndContext>` (line 273); change the trailing empty branch:

```tsx
      ) : (
        <p className="animate-reveal text-sm text-muted-foreground">
          {query ? `No decks match “${query}”.` : "No decks yet — create your first one."}
        </p>
      )}

      <div ref={sentinelRef} aria-hidden className="h-1" />
```

(The sentinel `<div>` goes immediately after the closing `)}` of the loading/list/empty conditional, before the "How to use" `<Card>`.)

- [ ] **Step 9: Typecheck + lint the client**

Run: `pnpm --filter client typecheck && pnpm --filter client lint`
Expected: PASS. If lint flags `exhaustive-deps` on the observer effect, the dep array already lists the three reactive values used — keep it.

---

## Task 6: e2e — search toggle assertion

**Files:**

- Modify: `packages/client/e2e/happy-path.spec.ts`

- [ ] **Step 1: Inspect the e2e to find where the deck list is visible**

Run: `grep -n "Your decks\|decks\|New deck\|getByRole" packages/client/e2e/happy-path.spec.ts`
Expected: a point in the happy path after login where the deck list ("Your decks") is shown.

- [ ] **Step 2: Add a search-toggle assertion at that point**

After the deck list is asserted visible, add:

```ts
// Search expands an input in the header pill.
await page.getByRole("button", { name: "Search decks" }).click()
const search = page.getByRole("textbox", { name: "Search decks" })
await expect(search).toBeFocused()
await search.fill("zzz-no-match")
await expect(page.getByText(/No decks match/)).toBeVisible()
await page.getByRole("button", { name: "Close search" }).click()
```

Place it where at least one deck already exists in the flow (so the "no match" text is meaningful). If the happy path has no deck at that moment, move the snippet to just after a deck is created.

- [ ] **Step 3: Run the e2e**

Run: `rm -f packages/server/prisma/e2e.db && pnpm test:e2e`
Expected: PASS (happy path + the search assertion).

---

## Task 7: Full quality-gate sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && (rm -f packages/server/prisma/e2e.db && pnpm test:e2e)`
Expected: all green — typecheck across packages, client lint, Vitest (Decks pagination/search/move), Playwright happy path.

- [ ] **Step 2: Format**

Run: `pnpm format`
Expected: files reformatted to Prettier (printWidth 100, no semicolons). Re-run `pnpm format:check` → PASS.

- [ ] **Step 3: Manual smoke (optional, recommended)**

Run: `pnpm dev`, open `http://localhost:5173`, create >30 decks (or seed), confirm: first 30 load, scrolling loads more, the search button expands an input that filters by name, and drag-reordering a deck persists after refresh.

- [ ] **Step 4: Leave changes uncommitted**

Per `feedback_no_commits_during_impl`: do NOT commit. Report the diff summary to the user and stop.

---

## Self-Review Notes

- **Spec coverage:** Float migration (T1) ✓; `decks.list` pagination+search returning `{items,nextCursor}` (T2) ✓; `decks.move` midpoint + end + top + hidden-neighbor + tie self-heal across all user decks + ownership (T3) ✓; expanding search button in pill (T4,T5) ✓; infinite scroll sentinel (T5) ✓; drag→`move` with anchor=`afterId` (T5) ✓; empty-state distinction (T5) ✓; Vitest + Playwright + typecheck + lint gates (T2,T3,T5,T6,T7) ✓; shared schema swap (T1) ✓.
- **Breaking-change coverage:** all `decks.list()` array readers in tests updated (T2 S1); `utils.decks.list.invalidate()` callers are shape-agnostic and need no change; `decks.reorder` removed and its only client caller rewritten (T5 S2/S6).
- **Type consistency:** `listDecksInput` fields `{cursor,limit,q}` and `moveDeckInput` `{id,afterId}` match server usage; `DeckItem` shape (`id,name,dueCount`) unchanged so `DeckCardBody`/`SortableDeckItem` need no edits.
