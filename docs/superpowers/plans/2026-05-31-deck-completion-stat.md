# Deck Completion Statistic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each deck's memorization completion percentage on the deck-detail page, derived from subjects' latest fixation levels, kept fresh via an incremental review-time update plus lazy full recompute on read.

**Architecture:** A cached `completionScore` (Float, nullable) lives on `Deck`. It is updated incrementally when a review is completed, fully recomputed lazily on `deck.get` when null or older than 24h, and invalidated (set null) on paths that delete subjects. The displayed percent is `round(score / liveSubjectCount * 100)`, computed at read time. A new `domains/decks/deck-completion.service.ts` owns recompute / invalidate / percent helpers (review.service.ts is already 513 lines, over the 500-line soft limit, so completion logic goes in the decks domain per the domain-first convention).

**Tech Stack:** Fastify + tRPC + Prisma + SQLite (server); Vite + React + TanStack (client); Vitest (server integration via `appRouter.createCaller` and direct service calls); Playwright (e2e). Shared zod/constants in `@cards/shared`.

---

## File Structure

- **Create** `packages/server/src/domains/decks/deck-completion.service.ts` — `COMPLETION_STALE_MS`, `pointsFor`, `recomputeDeckCompletion`, `markDeckCompletionStale`, `completionPercent`.
- **Create** `packages/server/tests/domains/deck-completion.test.ts` — integration tests for all of the above + review/drift wiring.
- **Modify** `packages/shared/src/fixation.ts` — add `COMPLETION_POINTS`.
- **Modify** `packages/server/prisma/schema.prisma` — add `completionScore Float?` + `completionComputedAt DateTime?` to `Deck`.
- **Modify** `packages/server/src/domains/decks/decks.router.ts` — `get` returns `completionPercent`, lazy recompute when stale.
- **Modify** `packages/server/src/domains/review/review.service.ts` — incremental delta / null self-heal inside `completeReview`'s transaction.
- **Modify** `packages/server/src/domains/subjects/subjects.service.ts` — `deleteSubjectIfEmpty` + `deleteEmptySubjectsForDeck` invalidate on actual deletion.
- **Modify** `packages/server/src/domains/cards/cards.router.ts` — pass `deckId` into `deleteSubjectIfEmpty` (two call sites).
- **Modify** `packages/server/src/domains/subjects/subjects.router.ts` — `delete` invalidates the deck.
- **Modify** `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/index.ts` — invalidate deck after a spreadsheet import succeeds.
- **Modify** `packages/client/src/domains/decks/deck-detail.page/DeckSubjectStatsBar.tsx` — accept + render `completionPercent`.
- **Modify** `packages/client/src/domains/decks/deck-detail.page/index.tsx` — pass `deck.data.completionPercent`.
- **Modify** `packages/client/e2e/happy-path.spec.ts` — new test asserting the percent.

---

## Task 1: Add `COMPLETION_POINTS` to shared

**Files:**

- Modify: `packages/shared/src/fixation.ts`
- Test: covered by Task 3 (shared has no test runner; the recompute test exercises this map).

- [ ] **Step 1: Add the constant**

In `packages/shared/src/fixation.ts`, after the `COOLDOWN_MS` block (around line 15), add:

```ts
export const COMPLETION_POINTS: Record<FixationLevel, number> = {
  "1": 0,
  "2": 0,
  "3": 0.25,
  "4": 0.5,
  "5": 0.75,
  "6": 1,
}
```

- [ ] **Step 2: Verify it is exported and typechecks**

Run: `pnpm --filter @cards/shared exec tsc --noEmit` (or `pnpm typecheck`)
Expected: PASS. `@cards/shared` re-exports `./fixation.js` via `src/index.ts`, so `COMPLETION_POINTS` is now importable from `@cards/shared`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/fixation.ts
git commit -m "feat(shared): add COMPLETION_POINTS fixation-to-points map"
```

---

## Task 2: Prisma migration — add nullable completion columns to Deck

**Files:**

- Modify: `packages/server/prisma/schema.prisma:91-111` (the `Deck` model)

- [ ] **Step 1: Add the two columns**

In the `Deck` model, add these two fields (place them after `inverseReviewStreak Int @default(0)` on line 102):

```prisma
  completionScore          Float?
  completionComputedAt     DateTime?
```

Both nullable, no default → existing rows get `NULL`, meaning "not yet computed / stale".

- [ ] **Step 2: Create and apply the migration (non-interactive)**

Run: `pnpm --filter server exec prisma migrate dev --name add_deck_completion`
Expected: a new folder under `packages/server/prisma/migrations/` containing `ALTER TABLE "Deck" ADD COLUMN "completionScore" REAL;` and `... "completionComputedAt" DATETIME;`, and the Prisma client regenerates without error.

- [ ] **Step 3: Verify typecheck sees the new fields**

Run: `pnpm typecheck`
Expected: PASS (no usages yet; this just confirms the client regenerated).

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations
git commit -m "feat(db): add nullable completionScore + completionComputedAt to Deck"
```

---

## Task 3: `deck-completion.service.ts` — recompute, invalidate, percent

**Files:**

- Create: `packages/server/src/domains/decks/deck-completion.service.ts`
- Create: `packages/server/tests/domains/deck-completion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/domains/deck-completion.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import {
  completionPercent,
  markDeckCompletionStale,
  pointsFor,
  recomputeDeckCompletion,
} from "../../src/domains/decks/deck-completion.service.js"
import { subjectKeyFor } from "../../src/domains/subjects/subjects.service.js"

async function makeDeck(userId: string, name = "Deck") {
  return prisma.deck.create({ data: { name, userId } })
}

async function addSubject(userId: string, deckId: string, text: string, fixationLevel: string) {
  return prisma.subject.create({
    data: { userId, deckId, subject: text, subjectKey: subjectKeyFor(text), fixationLevel },
  })
}

describe("deck-completion.service", () => {
  beforeEach(resetDomain)

  it("pointsFor maps levels and tolerates unknown", () => {
    expect(pointsFor("1")).toBe(0)
    expect(pointsFor("3")).toBe(0.25)
    expect(pointsFor("6")).toBe(1)
    expect(pointsFor("nonsense")).toBe(0)
  })

  it("completionPercent rounds, and returns null for 0 subjects or null score", () => {
    expect(completionPercent(0.25, 1)).toBe(25)
    expect(completionPercent(1.5, 2)).toBe(75)
    expect(completionPercent(null, 3)).toBeNull()
    expect(completionPercent(0, 0)).toBeNull()
  })

  it("recomputeDeckCompletion sums points across subjects and stamps computedAt", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    await addSubject(userId, deck.id, "a", "6") // 1
    await addSubject(userId, deck.id, "b", "4") // 0.5
    await addSubject(userId, deck.id, "c", "1") // 0
    const now = new Date("2026-05-31T12:00:00Z")

    const score = await recomputeDeckCompletion(prisma, deck.id, now)

    expect(score).toBe(1.5)
    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBe(1.5)
    expect(row.completionComputedAt?.toISOString()).toBe(now.toISOString())
  })

  it("markDeckCompletionStale nulls both fields", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    await recomputeDeckCompletion(prisma, deck.id, new Date())

    await markDeckCompletionStale(prisma, deck.id)

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeNull()
    expect(row.completionComputedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server test -- deck-completion`
Expected: FAIL — module `deck-completion.service.js` not found.

- [ ] **Step 3: Implement the service**

Create `packages/server/src/domains/decks/deck-completion.service.ts`:

```ts
import { COMPLETION_POINTS, type FixationLevel } from "@cards/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"

type Db = PrismaClient | Prisma.TransactionClient

export const COMPLETION_STALE_MS = 24 * 60 * 60 * 1000

export function pointsFor(level: string): number {
  return COMPLETION_POINTS[level as FixationLevel] ?? 0
}

export function completionPercent(score: number | null, subjectCount: number): number | null {
  if (score == null || subjectCount <= 0) return null
  return Math.round((score / subjectCount) * 100)
}

export async function recomputeDeckCompletion(db: Db, deckId: string, now = new Date()) {
  const groups = await db.subject.groupBy({
    by: ["fixationLevel"],
    where: { deckId },
    _count: true,
  })
  let score = 0
  for (const group of groups) {
    score += pointsFor(group.fixationLevel) * group._count
  }
  await db.deck.update({
    where: { id: deckId },
    data: { completionScore: score, completionComputedAt: now },
  })
  return score
}

export async function markDeckCompletionStale(db: Db, deckId: string) {
  await db.deck.update({
    where: { id: deckId },
    data: { completionScore: null, completionComputedAt: null },
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server test -- deck-completion`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domains/decks/deck-completion.service.ts packages/server/tests/domains/deck-completion.test.ts
git commit -m "feat(decks): add deck completion recompute/invalidate/percent service"
```

---

## Task 4: `deck.get` returns `completionPercent` with lazy recompute

**Files:**

- Modify: `packages/server/src/domains/decks/decks.router.ts:52-98` (the `get` procedure)
- Test: `packages/server/tests/domains/deck-completion.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/domains/deck-completion.test.ts` (add `callerFor` to the existing helpers import at the top: `import { callerFor, makeUser, resetDomain } from "../helpers.js"`):

```ts
describe("decks.get completionPercent (lazy recompute)", () => {
  beforeEach(resetDomain)

  it("returns null percent for a deck with no subjects", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "Empty", userId } })
    const res = await callerFor(userId).decks.get({ id: deck.id })
    expect(res.completionPercent).toBeNull()
  })

  it("recomputes when completionScore is null and returns the percent", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "Fresh", userId } })
    await prisma.subject.create({
      data: { userId, deckId: deck.id, subject: "a", subjectKey: "a", fixationLevel: "3" },
    })
    // completionScore starts null
    const res = await callerFor(userId).decks.get({ id: deck.id })
    expect(res.completionPercent).toBe(25)
    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBe(0.25)
    expect(row.completionComputedAt).not.toBeNull()
  })

  it("recomputes when completionComputedAt is older than 24h", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: {
        name: "Stale",
        userId,
        completionScore: 0, // wrong on purpose
        completionComputedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    })
    await prisma.subject.create({
      data: { userId, deckId: deck.id, subject: "a", subjectKey: "a", fixationLevel: "6" },
    })
    const res = await callerFor(userId).decks.get({ id: deck.id })
    expect(res.completionPercent).toBe(100)
  })

  it("does not recompute when fresh (uses cached score)", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: {
        name: "Cached",
        userId,
        completionScore: 0.5, // stale value, but recent timestamp
        completionComputedAt: new Date(),
      },
    })
    await prisma.subject.create({
      data: { userId, deckId: deck.id, subject: "a", subjectKey: "a", fixationLevel: "6" },
    })
    const res = await callerFor(userId).decks.get({ id: deck.id })
    expect(res.completionPercent).toBe(50) // cached 0.5 / 1 subject, NOT recomputed to 100
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server test -- deck-completion`
Expected: FAIL — `res.completionPercent` is `undefined` (property does not exist yet).

- [ ] **Step 3: Implement lazy recompute in `decks.get`**

In `packages/server/src/domains/decks/decks.router.ts`:

Add the import near the top (after line 6):

```ts
import {
  COMPLETION_STALE_MS,
  completionPercent,
  recomputeDeckCompletion,
} from "./deck-completion.service.js"
```

In the `get` procedure, after the `if (!deck) throw new TRPCError({ code: "NOT_FOUND" })` line (currently line 82), insert:

```ts
let completionScore = deck.completionScore
const stale =
  completionScore == null ||
  deck.completionComputedAt == null ||
  now.getTime() - deck.completionComputedAt.getTime() > COMPLETION_STALE_MS
if (stale) {
  completionScore = await recomputeDeckCompletion(ctx.prisma, deck.id, now)
}
```

Then add `completionPercent` to the returned object (inside the `return { ... }`, alongside `wordCount`):

```ts
      completionPercent: completionPercent(completionScore, wordCount),
```

(`now` already exists at the top of `get` as `const now = new Date()`. `deck.completionScore` / `deck.completionComputedAt` are scalar fields returned by the existing `findFirst` — no `select`/`include` change needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server test -- deck-completion`
Expected: PASS (all `decks.get` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domains/decks/decks.router.ts packages/server/tests/domains/deck-completion.test.ts
git commit -m "feat(decks): deck.get returns completionPercent with lazy recompute"
```

---

## Task 5: Incremental update in `completeReview`

**Files:**

- Modify: `packages/server/src/domains/review/review.service.ts:270-309` (non-inverse branch transaction)
- Test: `packages/server/tests/domains/deck-completion.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/domains/deck-completion.test.ts` (add this import at the top: `import { completeReview } from "../../src/domains/review/review.service.js"`):

```ts
async function seedCard(userId: string, deckId: string, text: string, fixationLevel: string) {
  const subject = await prisma.subject.create({
    data: { userId, deckId, subject: text, subjectKey: subjectKeyFor(text), fixationLevel },
  })
  const card = await prisma.card.create({
    data: { deckId, subjectId: subject.id, front: `f-${text}`, frontHash: text, back: `b-${text}` },
  })
  return { subject, card }
}

describe("completeReview completion update", () => {
  beforeEach(resetDomain)

  it("applies the delta when completionScore is already set", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: { name: "D", userId, completionScore: 0, completionComputedAt: new Date() },
    })
    const { card } = await seedCard(userId, deck.id, "a", "1") // prev points 0

    await completeReview(prisma, userId, card.id, { chosenLevel: "3" }) // 0.25

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeCloseTo(0.25, 5)
  })

  it("applies a negative delta when fixation drops", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: { name: "D", userId, completionScore: 1, completionComputedAt: new Date() },
    })
    const { card } = await seedCard(userId, deck.id, "a", "6") // prev points 1

    await completeReview(prisma, userId, card.id, { chosenLevel: "3" }) // 0.25, delta -0.75

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeCloseTo(0.25, 5)
  })

  it("full-recomputes when completionScore is null (self-heal)", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId } }) // score null
    const { card } = await seedCard(userId, deck.id, "a", "1")
    await seedCard(userId, deck.id, "b", "6") // contributes 1 to a full recompute

    await completeReview(prisma, userId, card.id, { chosenLevel: "5" }) // a → 0.75

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeCloseTo(1.75, 5) // 0.75 (a) + 1 (b)
    expect(row.completionComputedAt).not.toBeNull()
  })

  it("inverse review does not change completionScore", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: { name: "D", userId, completionScore: 0.5, completionComputedAt: new Date() },
    })
    const { card } = await seedCard(userId, deck.id, "a", "4")

    await completeReview(prisma, userId, card.id, { inverse: true })

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server test -- deck-completion`
Expected: FAIL — `completionScore` is unchanged / still `0` / still `null` (no completion logic in `completeReview` yet).

- [ ] **Step 3: Implement the incremental update**

In `packages/server/src/domains/review/review.service.ts`:

Add the import (after the existing subjects.service import block, around line 9):

```ts
import { pointsFor, recomputeDeckCompletion } from "../decks/deck-completion.service.js"
```

Capture the previous level just before the transaction. After this line (currently 273):

```ts
const chosenLevel = fixationLevelSchema.parse(options.chosenLevel)
```

add:

```ts
const previousLevel = card.subject.fixationLevel
```

Then, inside the existing `await prisma.$transaction(async (tx) => { ... })` (the one starting at line 282), **after** the `tx.subject.update(...)` that sets the new `fixationLevel` (currently ends at line 298) and before the `tx.subject.updateMany(... firstSeenAt ...)` call, insert:

```ts
const deckRow = await tx.deck.findUnique({
  where: { id: card.deckId },
  select: { completionScore: true },
})
if (deckRow?.completionScore == null) {
  await recomputeDeckCompletion(tx, card.deckId, now)
} else {
  const delta = pointsFor(chosenLevel) - pointsFor(previousLevel)
  if (delta !== 0) {
    await tx.deck.update({
      where: { id: card.deckId },
      data: { completionScore: { increment: delta } },
    })
  }
}
```

(The recompute branch reads the subject's level _after_ the update, so it must run after `tx.subject.update`. The inverse branch at lines 251-268 is untouched, so inverse reviews never change the score.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server test -- deck-completion`
Expected: PASS (4 `completeReview` tests green).

- [ ] **Step 5: Run the full review suite to confirm no regression**

Run: `pnpm --filter server test -- review`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/domains/review/review.service.ts packages/server/tests/domains/deck-completion.test.ts
git commit -m "feat(review): update deck completionScore incrementally on review"
```

---

## Task 6: Invalidate completion on subject-deletion (drift) paths

**Files:**

- Modify: `packages/server/src/domains/subjects/subjects.service.ts:40-61`
- Modify: `packages/server/src/domains/cards/cards.router.ts:146,165`
- Modify: `packages/server/src/domains/subjects/subjects.router.ts:89-97`
- Modify: `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/index.ts:174-187`
- Test: `packages/server/tests/domains/deck-completion.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/tests/domains/deck-completion.test.ts` (add `callerFor` is already imported from Task 4):

```ts
describe("completion invalidation on drift paths", () => {
  beforeEach(resetDomain)

  it("deleting a card that empties its subject nulls completionScore", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: { name: "D", userId, completionScore: 1, completionComputedAt: new Date() },
    })
    const { card } = await seedCard(userId, deck.id, "a", "6")

    await callerFor(userId).cards.delete({ id: card.id })

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeNull()
    expect(row.completionComputedAt).toBeNull()
  })

  it("deleting a subject nulls completionScore", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({
      data: { name: "D", userId, completionScore: 1, completionComputedAt: new Date() },
    })
    const { subject } = await seedCard(userId, deck.id, "a", "6")

    await callerFor(userId).subjects.delete({ id: subject.id })

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(row.completionScore).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter server test -- deck-completion`
Expected: FAIL — `completionScore` is still `1` after the deletes.

- [ ] **Step 3: Make `deleteSubjectIfEmpty` / `deleteEmptySubjectsForDeck` invalidate**

In `packages/server/src/domains/subjects/subjects.service.ts`, add the import at the top (after line 2):

```ts
import { markDeckCompletionStale } from "../decks/deck-completion.service.js"
```

Replace `deleteSubjectIfEmpty` (lines 40-47) with a version that takes `deckId` and invalidates only when a row was actually deleted:

```ts
export async function deleteSubjectIfEmpty(prisma: SubjectDb, subjectId: string, deckId: string) {
  const result = await prisma.subject.deleteMany({
    where: {
      id: subjectId,
      cards: { none: {} },
    },
  })
  if (result.count > 0) await markDeckCompletionStale(prisma, deckId)
  return result
}
```

Replace `deleteEmptySubjectsForDeck` (lines 49-61) similarly:

```ts
export async function deleteEmptySubjectsForDeck(
  prisma: SubjectDb,
  userId: string,
  deckId: string
) {
  const result = await prisma.subject.deleteMany({
    where: {
      userId,
      deckId,
      cards: { none: {} },
    },
  })
  if (result.count > 0) await markDeckCompletionStale(prisma, deckId)
  return result
}
```

- [ ] **Step 4: Update `deleteSubjectIfEmpty` call sites in cards.router.ts**

In `packages/server/src/domains/cards/cards.router.ts`:

- Line 146: `if (previousSubjectId) await deleteSubjectIfEmpty(tx, previousSubjectId)` → `if (previousSubjectId) await deleteSubjectIfEmpty(tx, previousSubjectId, card.deckId)`
- Line 165: `await deleteSubjectIfEmpty(tx, card.subjectId)` → `await deleteSubjectIfEmpty(tx, card.subjectId, card.deckId)`

(`card` is in scope in both blocks — line 146 is inside the `update` mutation where `card` is the loaded card, line 165 inside `delete`.)

- [ ] **Step 5: Invalidate in subjects.router delete**

In `packages/server/src/domains/subjects/subjects.router.ts`, the `delete` procedure (lines 89-97). Change the `select` to include `deckId`, and invalidate after deleting:

```ts
  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const subject = await ctx.prisma.subject.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true, deckId: true },
    })
    if (!subject) throw new TRPCError({ code: "NOT_FOUND" })
    await ctx.prisma.subject.delete({ where: { id: subject.id } })
    await markDeckCompletionStale(ctx.prisma, subject.deckId)
    return { ok: true }
  }),
```

Add the import at the top of `subjects.router.ts`:

```ts
import { markDeckCompletionStale } from "../decks/deck-completion.service.js"
```

- [ ] **Step 6: Invalidate after a successful spreadsheet import**

In `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/index.ts`, inside `runDeckSpreadsheetImportJob`, after the final `prisma.spreadsheetImport.update({ ... status: SUCCEEDED ... })` block (ends line 186), add:

```ts
await markDeckCompletionStale(prisma, spreadsheetImport.deckId)
```

Add the import near the other domain imports (after line 11):

```ts
import { markDeckCompletionStale } from "../../decks/deck-completion.service.js"
```

(Spreadsheet imports can delete cards/subjects; invalidating once on completion is the simplest correct option. Anki imports create a brand-new deck whose `completionScore` is already `null`, so no change is needed there.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter server test -- deck-completion`
Expected: PASS (both invalidation tests green).

- [ ] **Step 8: Run cards + subjects + spreadsheet suites for regressions**

Run: `pnpm --filter server test -- cards subjects deck-spreadsheet`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/domains/subjects/subjects.service.ts packages/server/src/domains/cards/cards.router.ts packages/server/src/domains/subjects/subjects.router.ts packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/index.ts packages/server/tests/domains/deck-completion.test.ts
git commit -m "feat: invalidate deck completionScore on subject-deletion paths"
```

---

## Task 7: Render the percent in the deck-detail stats line

**Files:**

- Modify: `packages/client/src/domains/decks/deck-detail.page/DeckSubjectStatsBar.tsx:15-22,51-58,265-267`
- Modify: `packages/client/src/domains/decks/deck-detail.page/index.tsx:280-287`

- [ ] **Step 1: Add the prop to `DeckSubjectStatsBar`**

In `DeckSubjectStatsBar.tsx`, add to `DeckSubjectStatsBarProps` (after `dueIn48h?: number` on line 21):

```ts
  completionPercent?: number | null
```

Add it to the destructured params in the component signature (after `dueIn48h,` on line 57):

```ts
  completionPercent,
```

- [ ] **Step 2: Render it on the count line**

In `DeckSubjectStatsBar.tsx`, replace the count-line content (line 266):

```tsx
            {formatCount(subjectCount, "subject")}, {formatCount(cardCount, "card")}
```

with:

```tsx
            {formatCount(subjectCount, "subject")}, {formatCount(cardCount, "card")}
            {completionPercent != null ? `, ${completionPercent}%` : ""}
```

- [ ] **Step 3: Pass the value from the page**

In `deck-detail.page/index.tsx`, in the `<DeckSubjectStatsBar .../>` usage (lines 280-287), add the prop (after `dueIn48h={upcoming.data?.in2d}` on line 286):

```tsx
            completionPercent={deck.data.completionPercent}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (`deck.data.completionPercent` is typed `number | null` via the tRPC `AppRouter` inference from Task 4.)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/domains/decks/deck-detail.page/DeckSubjectStatsBar.tsx packages/client/src/domains/decks/deck-detail.page/index.tsx
git commit -m "feat(client): show deck completion percent on the stats line"
```

---

## Task 8: e2e — percent appears and updates after a review

**Files:**

- Modify: `packages/client/e2e/happy-path.spec.ts` (append a new `test(...)`)

- [ ] **Step 1: Add the test**

Append to `packages/client/e2e/happy-path.spec.ts`:

```ts
test("deck completion percent updates after a review", async ({ page }) => {
  const email = `e2e-completion-${Date.now()}@test.local`
  const password = "passw0rd!"

  await page.addInitScript(() => {
    type SpeechRecognitionMockWindow = Window &
      typeof globalThis & {
        SpeechRecognition?: unknown
        webkitSpeechRecognition?: unknown
      }
    class MockSpeechRecognition {
      static async available() {
        return "available"
      }
    }
    const speechWindow = window as SpeechRecognitionMockWindow
    speechWindow.SpeechRecognition = MockSpeechRecognition
    speechWindow.webkitSpeechRecognition = MockSpeechRecognition
  })

  await page.goto("/signup")
  await page.getByLabel("Name").fill("E2E Completion")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign up" }).click()
  await page.getByRole("link", { name: "Back to log in" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()

  await page.getByRole("button", { name: "New deck" }).click()
  await page.getByPlaceholder("e.g. German A1").fill("German Completion")
  const studyLanguageSelect = page.locator("select").nth(1)
  const deutschLanguageId = await studyLanguageSelect
    .locator("option", { hasText: "Deutsch" })
    .getAttribute("value")
  if (!deutschLanguageId) throw new Error("Deutsch language option was not seeded")
  await studyLanguageSelect.selectOption(deutschLanguageId)
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByRole("link", { name: /German Completion/ }).click()
  const deckUrl = page.url()

  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Add card" }).click()
  await page.getByRole("textbox", { name: "Subject" }).fill("Haus")
  await page.getByRole("textbox", { name: "Front" }).fill("Haus front.")
  await page.getByRole("textbox", { name: "Back" }).fill("Haus back.")
  await page.getByRole("button", { name: "Create" }).click()

  // Fresh deck: the single subject is unseen → lazy recompute yields 0%.
  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card, 0%")

  await page.getByRole("link", { name: /Review 1 due/ }).click()
  await expect(page.getByText("Haus front.")).toBeVisible()
  await page.getByRole("button", { name: "Reveal" }).click()
  await page.getByRole("button", { name: /^3/ }).click()
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible()

  // Reviewed at fixation 3 → 0.25 over 1 subject → 25%.
  await page.goto(deckUrl)
  await expect(page.getByTestId("deck-subject-stats")).toContainText("1 subject, 1 card, 25%")
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS. If the e2e DB is sticky, delete `packages/server/prisma/e2e.db` first and re-run.

- [ ] **Step 3: Commit**

```bash
git add packages/client/e2e/happy-path.spec.ts
git commit -m "test(e2e): assert deck completion percent renders and updates after review"
```

---

## Task 9: Full quality-gate sweep + format

**Files:** none (verification) + any Prettier reflow.

- [ ] **Step 1: Format the whole repo**

Run: `pnpm format`
Expected: writes any formatting; review the diff is cosmetic only.

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all PASS. (Per CLAUDE.md this is the full suite; delete `packages/server/prisma/e2e.db` first if e2e is sticky.)

- [ ] **Step 3: Commit any formatting**

```bash
git add -A
git commit -m "chore: format after deck completion feature"
```

(If `pnpm format` produced no changes, skip this commit.)

---

## Notes / decisions captured during planning

- **Adds don't drift:** new subjects default to fixation `"1"` (0 points), and the percent denominator (`subjectCount`) is read live at `deck.get` time — only the numerator (`completionScore`) is cached. So creating subjects/cards correctly lowers the percent without any invalidation; only _deletions_ of subjects need invalidation.
- **Fresh decks show `0%`, not hidden:** the first `deck.get` lazy-recomputes a `null` score to a real number (`0` for an all-unseen deck), so the percent is hidden only for decks with **zero subjects**. This matches "100% when all subjects are at fixation 6".
- **Inverse reviews** never change `fixationLevel`, so the inverse branch of `completeReview` is intentionally left untouched.
- Out of scope (per spec): any debounce/batched writer, background timers/cron, and changes to `ReviewStat` (cardMinutes/cardCount) logic.
