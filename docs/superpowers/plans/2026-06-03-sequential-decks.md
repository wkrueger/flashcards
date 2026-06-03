# Sequential Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-deck "Sequential deck" mode that walks subjects/cards in a fixed editable order, showing "Next" on every card except the last of a subject (which keeps fixation buttons), with Prev/Restart controls, plus order columns in XLS import/export.

**Architecture:** New `Deck.sequentialEnabled` flag and nullable `order` on `Subject`/`Card`. Server adds `review.sequential` (punctual neighbor-subject cursor queries, no whole-deck scan), `review.advance` (lastSeen-only write), and `subjects.reorderCard`. Client branches `ReviewPage` on the flag and adds reorder buttons + an Options submenu.

**Tech Stack:** Prisma + SQLite, tRPC, Fastify, Vitest (server integration via `appRouter.createCaller`), React + TanStack Router/Query, ExcelJS, Playwright.

**IMPORTANT — no commits during implementation (user preference):** Do NOT run `git commit`. Each task ends by running its tests/QA green and leaving changes in the working tree. The user commits.

**Spec:** `docs/superpowers/specs/2026-06-03-sequential-decks-design.md`

**Reference conventions:** Prettier (printWidth 100, no semicolons) — run `pnpm format` before finishing. Prisma client imported from `"../../generated/prisma/client.js"` (relative `.js`). Server/shared have no ESLint; client ESLint is minimal. After any `routes/` change the TanStack plugin regenerates `routeTree.gen.ts` on build.

---

## Task 1: Schema — flag + order columns

**Files:**

- Modify: `packages/server/prisma/schema.prisma`
- Generated: new migration under `packages/server/prisma/migrations/`

- [ ] **Step 1: Add fields to schema**

In `model Deck`, add after `inverseReviewStreak`:

```prisma
  sequentialEnabled        Boolean                @default(false)
```

In `model Subject`, add after `fixationLevel`:

```prisma
  order           Int?
```

In `model Card`, add after `timesSeen`:

```prisma
  order                 Int?
```

- [ ] **Step 2: Create and apply the migration**

Run: `pnpm --filter server exec prisma migrate dev --name sequential_decks`
Expected: migration created, applied to `packages/server/prisma/dev.db`, Prisma client regenerated under `packages/server/src/generated/prisma`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no usages yet).

---

## Task 2: Shared schema — deck input + new review/subject inputs

**Files:**

- Modify: `packages/shared/src/schemas.ts`

- [ ] **Step 1: Add `sequentialEnabled` to deck inputs**

In `createDeckInput`, add:

```ts
  sequentialEnabled: z.boolean().optional(),
```

In `updateDeckInput`, add the same line.

- [ ] **Step 2: Add sequential review + advance + reorder inputs**

After `reviewCompleteInput`, add:

```ts
export const sequentialMoveSchema = z.enum(["resume", "next", "prev", "first"])
export type SequentialMove = z.infer<typeof sequentialMoveSchema>

export const reviewSequentialInput = z.object({
  deckId: id,
  cardId: id.optional(),
  move: sequentialMoveSchema,
})

export const reviewAdvanceInput = z.object({ cardId: id })

export const reorderCardInput = z.object({
  cardId: id,
  direction: z.enum(["up", "down"]),
})
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 3: Decks router — persist + return `sequentialEnabled`

**Files:**

- Modify: `packages/server/src/domains/decks/decks.router.ts`
- Test: `packages/server/tests/domains/decks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/domains/decks.test.ts` inside the existing top-level `describe` (match the file's existing style for `makeUser`/`callerFor`):

```ts
describe("sequential flag", () => {
  it("defaults to false and can be toggled via update", async () => {
    const userId = await makeUser()
    const caller = callerFor(userId)
    const deck = await caller.decks.create({ name: "Seq" })

    const fresh = await caller.decks.get({ id: deck.id })
    expect(fresh.sequentialEnabled).toBe(false)

    await caller.decks.update({ id: deck.id, sequentialEnabled: true })
    const updated = await caller.decks.get({ id: deck.id })
    expect(updated.sequentialEnabled).toBe(true)
  })
})
```

If `describe`/`makeUser`/`callerFor` are not already imported in this file, add them to the existing imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- decks.test.ts`
Expected: FAIL — `sequentialEnabled` is `undefined` on the `get` result.

- [ ] **Step 3: Implement**

In `decks.router.ts` `get` query, add `sequentialEnabled: deck.sequentialEnabled,` to the returned object (next to `inverseReviewEnabled`).

In the `create` mutation `data`, add:

```ts
        sequentialEnabled: input.sequentialEnabled ?? false,
```

In the `update` mutation, after the `inverseReviewEnabled` conditional, add:

```ts
if (input.sequentialEnabled !== undefined) data.sequentialEnabled = input.sequentialEnabled
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- decks.test.ts`
Expected: PASS.

---

## Task 4: Global card ordering in `subjects.get`

**Files:**

- Modify: `packages/server/src/domains/subjects/subjects.router.ts`
- Test: `packages/server/tests/domains/` — add `subjects.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/domains/subjects.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { subjectKeyFor } from "../../src/domains/subjects/subjects.service.js"
import { hashFront } from "../../src/domains/cards/cards.service.js"

beforeEach(resetDomain)

async function makeDeckWithSubject(userId: string) {
  const deck = await prisma.deck.create({ data: { name: "D", userId } })
  const subject = await prisma.subject.create({
    data: { deckId: deck.id, userId, subject: "s", subjectKey: subjectKeyFor("s"), randomKey: 1 },
  })
  return { deck, subject }
}

async function addCard(deckId: string, subjectId: string, front: string, order: number | null) {
  return prisma.card.create({
    data: { deckId, subjectId, front, frontHash: hashFront(front), back: `b-${front}`, order },
  })
}

describe("subjects.get ordering", () => {
  it("orders cards by order then createdAt, nulls last", async () => {
    const userId = await makeUser()
    const { deck, subject } = await makeDeckWithSubject(userId)
    // created in this order; nulls should fall back to createdAt asc, ordered first by `order`
    const c1 = await addCard(deck.id, subject.id, "null-a", null)
    const c2 = await addCard(deck.id, subject.id, "ord-2", 2)
    const c3 = await addCard(deck.id, subject.id, "ord-1", 1)
    const c4 = await addCard(deck.id, subject.id, "null-b", null)

    const result = await callerFor(userId).subjects.get({ id: subject.id })
    expect(result.cards.map((c) => c.id)).toEqual([c3.id, c2.id, c1.id, c4.id])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- subjects.test.ts`
Expected: FAIL — current order is `createdAt desc`, so it returns `[c4, c3, c2, c1]`.

- [ ] **Step 3: Implement**

In `subjects.router.ts` `get`, change the cards include `orderBy`:

```ts
        cards: {
          orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          include: subjectCardInclude,
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- subjects.test.ts`
Expected: PASS.

---

## Task 5: `review.advance` (Next on non-last cards)

**Files:**

- Modify: `packages/server/src/domains/review/review.service.ts` (add `advanceCard`)
- Modify: `packages/server/src/domains/review/review.router.ts`
- Test: `packages/server/tests/domains/review.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `review.test.ts`:

```ts
describe("review.advance", () => {
  it("updates only the card lastSeenAt, no fixation/cooldown/subject change", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId } })
    const subject = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: "s",
        subjectKey: subjectKeyFor("s"),
        randomKey: 1,
        fixationLevel: "3",
      },
    })
    const beforeCooldown = subject.cooldownAt
    const card = await prisma.card.create({
      data: { deckId: deck.id, subjectId: subject.id, front: "f", frontHash: "fh", back: "b" },
    })

    await callerFor(userId).review.advance({ cardId: card.id })

    const updatedCard = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    const updatedSubject = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })
    expect(updatedCard.lastSeenAt).not.toBeNull()
    expect(updatedSubject.fixationLevel).toBe("3")
    expect(updatedSubject.lastSeenAt).toBeNull()
    expect(updatedSubject.cooldownAt.getTime()).toBe(beforeCooldown.getTime())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- review.test.ts`
Expected: FAIL — `review.advance` does not exist.

- [ ] **Step 3: Implement service function**

Append to `review.service.ts`:

```ts
export async function advanceCard(
  prisma: PrismaClient,
  userId: string,
  cardId: string,
  now: Date = new Date()
) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    select: { id: true },
  })
  if (!card) throw Object.assign(new Error("Card not found"), { code: "CARD_NOT_FOUND" })
  await prisma.card.update({ where: { id: card.id }, data: { lastSeenAt: now } })
  return { ok: true }
}
```

- [ ] **Step 4: Wire the router**

In `review.router.ts`, import `advanceCard` and `reviewAdvanceInput`:

```ts
import { reviewAdvanceInput, reviewCompleteInput, reviewNextInput } from "@cards/shared"
import { advanceCard, completeReview, pickNextCard } from "./review.service.js"
```

Add the mutation inside `reviewRouter`:

```ts
  advance: protectedProcedure.input(reviewAdvanceInput).mutation(async ({ ctx, input }) => {
    try {
      return await advanceCard(ctx.prisma, ctx.user.id, input.cardId)
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "CARD_NOT_FOUND"
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      throw err
    }
  }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test -- review.test.ts`
Expected: PASS.

---

## Task 6: `review.sequential` — punctual ordered walk

**Files:**

- Create: `packages/server/src/domains/review/review.sequential.ts`
- Modify: `packages/server/src/domains/review/review.router.ts`
- Test: `packages/server/tests/domains/review-sequential.test.ts`

- [ ] **Step 1: Write the service**

Create `packages/server/src/domains/review/review.sequential.ts`:

```ts
import type { PrismaClient } from "../../generated/prisma/client.js"
import { Prisma } from "../../generated/prisma/client.js"
import type { SequentialMove } from "@cards/shared"

const cardOrderBy: Prisma.CardOrderByWithRelationInput[] = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
]
const subjectOrderBy: Prisma.SubjectOrderByWithRelationInput[] = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
]

export interface SequentialResult {
  card: {
    id: string
    deckId: string
    subjectId: string
    front: string
    back: string
    genTemplate: string | null
    tags: string[]
    subject: {
      id: string
      subject: string
      fixationLevel: string
      firstSeenAt: Date | null
      lastSeenAt: Date | null
    }
  } | null
  isLastInSubject: boolean
  hasPrev: boolean
  atEnd: boolean
}

type SubjectCursor = { id: string; order: number | null; createdAt: Date }

export async function sequentialCard(args: {
  prisma: PrismaClient
  userId: string
  deckId: string
  cardId?: string
  move: SequentialMove
}): Promise<SequentialResult> {
  const { prisma, userId, deckId, cardId, move } = args
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId }, select: { id: true } })
  if (!deck) throw Object.assign(new Error("Deck not found"), { code: "DECK_NOT_FOUND" })

  let targetId: string | null = null
  if (move === "first") {
    targetId = await firstCardId(prisma, userId, deckId)
  } else if (move === "resume") {
    targetId = await resumeCardId(prisma, userId, deckId)
  } else if (cardId) {
    targetId = await neighborCardId(prisma, userId, deckId, cardId, move)
  } else {
    targetId = await firstCardId(prisma, userId, deckId)
  }

  if (!targetId) {
    return { card: null, isLastInSubject: false, hasPrev: false, atEnd: move === "next" }
  }

  const card = await prisma.card.findFirst({
    where: { id: targetId, deckId, deck: { userId } },
    include: {
      subject: {
        select: {
          id: true,
          subject: true,
          fixationLevel: true,
          firstSeenAt: true,
          lastSeenAt: true,
          order: true,
          createdAt: true,
        },
      },
      cardTags: { include: { tag: true } },
    },
  })
  if (!card) return { card: null, isLastInSubject: false, hasPrev: false, atEnd: false }

  const sibs = await prisma.card.findMany({
    where: { subjectId: card.subjectId },
    orderBy: cardOrderBy,
    select: { id: true },
  })
  const idx = sibs.findIndex((c) => c.id === card.id)
  const isLastInSubject = idx === sibs.length - 1
  const isFirstInSubject = idx === 0
  const hasPrev = isFirstInSubject
    ? (await findAdjacentSubject(
        prisma,
        userId,
        deckId,
        { id: card.subject.id, order: card.subject.order, createdAt: card.subject.createdAt },
        "prev"
      )) !== null
    : true

  const tags = card.cardTags.map((ct) => ct.tag.name).sort()
  return {
    card: {
      id: card.id,
      deckId: card.deckId,
      subjectId: card.subjectId,
      front: card.front,
      back: card.back,
      genTemplate: card.genTemplate,
      tags,
      subject: {
        id: card.subject.id,
        subject: card.subject.subject,
        fixationLevel: card.subject.fixationLevel,
        firstSeenAt: card.subject.firstSeenAt,
        lastSeenAt: card.subject.lastSeenAt,
      },
    },
    isLastInSubject,
    hasPrev,
    atEnd: false,
  }
}

async function neighborCardId(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  cardId: string,
  direction: "next" | "prev"
): Promise<string | null> {
  const current = await prisma.card.findFirst({
    where: { id: cardId, deckId, deck: { userId } },
    select: {
      id: true,
      subjectId: true,
      subject: { select: { id: true, order: true, createdAt: true } },
    },
  })
  if (!current) return null

  const sibs = await prisma.card.findMany({
    where: { subjectId: current.subjectId },
    orderBy: cardOrderBy,
    select: { id: true },
  })
  const idx = sibs.findIndex((c) => c.id === cardId)

  if (direction === "next") {
    if (idx >= 0 && idx < sibs.length - 1) return sibs[idx + 1]!.id
    const nextSubj = await findAdjacentSubject(prisma, userId, deckId, current.subject, "next")
    if (!nextSubj) return null
    return edgeCardOfSubject(prisma, nextSubj.id, "first")
  }
  if (idx > 0) return sibs[idx - 1]!.id
  const prevSubj = await findAdjacentSubject(prisma, userId, deckId, current.subject, "prev")
  if (!prevSubj) return null
  return edgeCardOfSubject(prisma, prevSubj.id, "last")
}

async function findAdjacentSubject(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  current: SubjectCursor,
  direction: "next" | "prev"
): Promise<SubjectCursor | null> {
  const base = { userId, deckId }
  const select = { id: true, order: true, createdAt: true }

  if (direction === "next") {
    if (current.order !== null) {
      const greater = await prisma.subject.findFirst({
        where: {
          ...base,
          OR: [
            { order: { gt: current.order } },
            { order: current.order, createdAt: { gt: current.createdAt } },
          ],
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select,
      })
      if (greater) return greater
      return prisma.subject.findFirst({
        where: { ...base, order: null },
        orderBy: { createdAt: "asc" },
        select,
      })
    }
    return prisma.subject.findFirst({
      where: { ...base, order: null, createdAt: { gt: current.createdAt } },
      orderBy: { createdAt: "asc" },
      select,
    })
  }

  if (current.order === null) {
    const lesserNull = await prisma.subject.findFirst({
      where: { ...base, order: null, createdAt: { lt: current.createdAt } },
      orderBy: { createdAt: "desc" },
      select,
    })
    if (lesserNull) return lesserNull
    return prisma.subject.findFirst({
      where: { ...base, order: { not: null } },
      orderBy: [{ order: "desc" }, { createdAt: "desc" }],
      select,
    })
  }
  return prisma.subject.findFirst({
    where: {
      ...base,
      OR: [
        { order: { lt: current.order } },
        { order: current.order, createdAt: { lt: current.createdAt } },
      ],
    },
    orderBy: [{ order: "desc" }, { createdAt: "desc" }],
    select,
  })
}

async function edgeCardOfSubject(
  prisma: PrismaClient,
  subjectId: string,
  edge: "first" | "last"
): Promise<string | null> {
  const orderBy: Prisma.CardOrderByWithRelationInput[] =
    edge === "first"
      ? cardOrderBy
      : [{ order: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }]
  const card = await prisma.card.findFirst({ where: { subjectId }, orderBy, select: { id: true } })
  return card?.id ?? null
}

async function firstCardId(prisma: PrismaClient, userId: string, deckId: string) {
  const subject = await prisma.subject.findFirst({
    where: { userId, deckId },
    orderBy: subjectOrderBy,
    select: { id: true },
  })
  if (!subject) return null
  return edgeCardOfSubject(prisma, subject.id, "first")
}

async function resumeCardId(prisma: PrismaClient, userId: string, deckId: string) {
  const card = await prisma.card.findFirst({
    where: { deckId, deck: { userId }, lastSeenAt: { not: null } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true },
  })
  if (card) return card.id
  return firstCardId(prisma, userId, deckId)
}
```

- [ ] **Step 2: Wire the router**

In `review.router.ts`, import:

```ts
import {
  reviewAdvanceInput,
  reviewCompleteInput,
  reviewNextInput,
  reviewSequentialInput,
} from "@cards/shared"
import { sequentialCard } from "./review.sequential.js"
```

Add the query inside `reviewRouter`:

```ts
  sequential: protectedProcedure.input(reviewSequentialInput).query(async ({ ctx, input }) => {
    try {
      return await sequentialCard({
        prisma: ctx.prisma,
        userId: ctx.user.id,
        deckId: input.deckId,
        cardId: input.cardId,
        move: input.move,
      })
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "DECK_NOT_FOUND"
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      throw err
    }
  }),
```

- [ ] **Step 3: Write the tests**

Create `packages/server/tests/domains/review-sequential.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { subjectKeyFor } from "../../src/domains/subjects/subjects.service.js"
import { hashFront } from "../../src/domains/cards/cards.service.js"

beforeEach(resetDomain)

async function seed(userId: string) {
  const deck = await prisma.deck.create({
    data: { name: "Seq", userId, sequentialEnabled: true },
  })
  // two subjects, explicit order 1 then 2
  const sA = await prisma.subject.create({
    data: {
      deckId: deck.id,
      userId,
      subject: "A",
      subjectKey: subjectKeyFor("A"),
      randomKey: 1,
      order: 1,
    },
  })
  const sB = await prisma.subject.create({
    data: {
      deckId: deck.id,
      userId,
      subject: "B",
      subjectKey: subjectKeyFor("B"),
      randomKey: 2,
      order: 2,
    },
  })
  const mk = (deckId: string, subjectId: string, f: string, order: number) =>
    prisma.card.create({
      data: { deckId, subjectId, front: f, frontHash: hashFront(f), back: `b-${f}`, order },
    })
  const a1 = await mk(deck.id, sA.id, "a1", 1)
  const a2 = await mk(deck.id, sA.id, "a2", 2)
  const b1 = await mk(deck.id, sB.id, "b1", 1)
  return { deck, sA, sB, a1, a2, b1 }
}

describe("review.sequential", () => {
  it("first → first card of first subject", async () => {
    const userId = await makeUser()
    const { deck, a1 } = await seed(userId)
    const res = await callerFor(userId).review.sequential({ deckId: deck.id, move: "first" })
    expect(res.card?.id).toBe(a1.id)
    expect(res.isLastInSubject).toBe(false)
    expect(res.hasPrev).toBe(false)
  })

  it("next walks within subject then crosses to next subject", async () => {
    const userId = await makeUser()
    const { deck, a1, a2, b1 } = await seed(userId)
    const caller = callerFor(userId)
    const r1 = await caller.review.sequential({ deckId: deck.id, cardId: a1.id, move: "next" })
    expect(r1.card?.id).toBe(a2.id)
    expect(r1.isLastInSubject).toBe(true)
    const r2 = await caller.review.sequential({ deckId: deck.id, cardId: a2.id, move: "next" })
    expect(r2.card?.id).toBe(b1.id)
    expect(r2.isLastInSubject).toBe(true)
    expect(r2.hasPrev).toBe(true)
  })

  it("next past final card returns atEnd", async () => {
    const userId = await makeUser()
    const { deck, b1 } = await seed(userId)
    const res = await callerFor(userId).review.sequential({
      deckId: deck.id,
      cardId: b1.id,
      move: "next",
    })
    expect(res.card).toBeNull()
    expect(res.atEnd).toBe(true)
  })

  it("prev crosses back to previous subject's last card", async () => {
    const userId = await makeUser()
    const { deck, a2, b1 } = await seed(userId)
    const res = await callerFor(userId).review.sequential({
      deckId: deck.id,
      cardId: b1.id,
      move: "prev",
    })
    expect(res.card?.id).toBe(a2.id)
  })

  it("resume starts from the most recently seen card", async () => {
    const userId = await makeUser()
    const { deck, a2 } = await seed(userId)
    await prisma.card.update({ where: { id: a2.id }, data: { lastSeenAt: new Date() } })
    const res = await callerFor(userId).review.sequential({ deckId: deck.id, move: "resume" })
    expect(res.card?.id).toBe(a2.id)
  })

  it("resume falls back to first card when nothing seen", async () => {
    const userId = await makeUser()
    const { deck, a1 } = await seed(userId)
    const res = await callerFor(userId).review.sequential({ deckId: deck.id, move: "resume" })
    expect(res.card?.id).toBe(a1.id)
  })

  it("orders null-order subjects after explicitly-ordered ones, by createdAt", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId, sequentialEnabled: true } })
    const sNull = await prisma.subject.create({
      data: { deckId: deck.id, userId, subject: "N", subjectKey: subjectKeyFor("N"), randomKey: 9 },
    })
    const sOrd = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: "O",
        subjectKey: subjectKeyFor("O"),
        randomKey: 8,
        order: 5,
      },
    })
    const cNull = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: sNull.id,
        front: "n",
        frontHash: hashFront("n"),
        back: "b",
      },
    })
    const cOrd = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: sOrd.id,
        front: "o",
        frontHash: hashFront("o"),
        back: "b",
      },
    })
    const first = await callerFor(userId).review.sequential({ deckId: deck.id, move: "first" })
    expect(first.card?.id).toBe(cOrd.id)
    const next = await callerFor(userId).review.sequential({
      deckId: deck.id,
      cardId: cOrd.id,
      move: "next",
    })
    expect(next.card?.id).toBe(cNull.id)
  })

  it("scopes to the owner", async () => {
    const owner = await makeUser("owner")
    const other = await makeUser("other")
    const { deck } = await seed(owner)
    await expect(
      callerFor(other).review.sequential({ deckId: deck.id, move: "first" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server test -- review-sequential.test.ts`
Expected: PASS (all cases).

---

## Task 7: `subjects.reorderCard`

**Files:**

- Modify: `packages/server/src/domains/subjects/subjects.router.ts`
- Test: `packages/server/tests/domains/subjects.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `subjects.test.ts`:

```ts
import { reorderHelpers } from "../helpers.js" // remove if unused; otherwise inline

describe("subjects.reorderCard", () => {
  it("moves a card down and materializes integer order on all subject cards", async () => {
    const userId = await makeUser()
    const { deck, subject } = await makeDeckWithSubject(userId)
    const c1 = await addCard(deck.id, subject.id, "c1", null)
    const c2 = await addCard(deck.id, subject.id, "c2", null)
    const c3 = await addCard(deck.id, subject.id, "c3", null)

    await callerFor(userId).subjects.reorderCard({ cardId: c1.id, direction: "down" })

    const result = await callerFor(userId).subjects.get({ id: subject.id })
    expect(result.cards.map((c) => c.id)).toEqual([c2.id, c1.id, c3.id])
    const stored = await prisma.card.findMany({
      where: { subjectId: subject.id },
      select: { id: true, order: true },
    })
    expect(stored.every((c) => typeof c.order === "number")).toBe(true)
  })

  it("is a no-op at the boundary", async () => {
    const userId = await makeUser()
    const { deck, subject } = await makeDeckWithSubject(userId)
    const c1 = await addCard(deck.id, subject.id, "c1", null)
    await addCard(deck.id, subject.id, "c2", null)
    await callerFor(userId).subjects.reorderCard({ cardId: c1.id, direction: "up" })
    const result = await callerFor(userId).subjects.get({ id: subject.id })
    expect(result.cards[0]!.id).toBe(c1.id)
  })
})
```

Note: delete the `reorderHelpers` import line above — it is illustrative only; do not add a nonexistent import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- subjects.test.ts`
Expected: FAIL — `subjects.reorderCard` does not exist.

- [ ] **Step 3: Implement**

In `subjects.router.ts`, import the input:

```ts
import {
  idInput,
  renameSubjectInput,
  reorderCardInput,
  subjectAutocompleteInput,
} from "@cards/shared"
```

Add the mutation inside `subjectsRouter`:

```ts
  reorderCard: protectedProcedure.input(reorderCardInput).mutation(async ({ ctx, input }) => {
    const card = await ctx.prisma.card.findFirst({
      where: { id: input.cardId, deck: { userId: ctx.user.id } },
      select: { id: true, subjectId: true },
    })
    if (!card) throw new TRPCError({ code: "NOT_FOUND" })

    const cards = await ctx.prisma.card.findMany({
      where: { subjectId: card.subjectId },
      orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true },
    })
    const idx = cards.findIndex((c) => c.id === card.id)
    const swapIdx = input.direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= cards.length) return { ok: true }

    const reordered = [...cards]
    const tmp = reordered[idx]!
    reordered[idx] = reordered[swapIdx]!
    reordered[swapIdx] = tmp

    await ctx.prisma.$transaction(
      reordered.map((c, i) => ctx.prisma.card.update({ where: { id: c.id }, data: { order: i } }))
    )
    return { ok: true }
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- subjects.test.ts`
Expected: PASS.

---

## Task 8: XLS import/export — order columns

**Files:**

- Modify: `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/workbook.ts`
- Modify: `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/index.ts`
- Modify: `packages/server/src/domains/deck-spreadsheet/deck-spreadsheet.service/import-rows.ts`
- Test: `packages/server/tests/domains/deck-spreadsheet.test.ts`

- [ ] **Step 1: Write the failing tests**

In `deck-spreadsheet.test.ts`, update the local `writeWorkbook` helper to support the new columns (header row and per-row cells):

```ts
const card = workbook.addWorksheet("Card")
card.addRow(["id", "subjectName", "subjectOrder", "front", "back", "cardOrder", "tags"])
for (const row of rows) {
  card.addRow([
    row.id ?? "",
    row.subjectName ?? "",
    row.subjectOrder ?? "",
    row.front ?? "",
    row.back ?? "",
    row.cardOrder ?? "",
    row.tags ?? "",
  ])
}
```

And widen its `rows` param type:

```ts
rows: Array<{
  id?: string
  subjectName?: string
  subjectOrder?: number | string
  front?: string
  back?: string
  cardOrder?: number | string
  tags?: string
}>
```

Add a new test (place near the other import tests, using whatever queue/run pattern the existing import tests use — replicate an existing passing import test and add the order assertions):

```ts
describe("spreadsheet order columns", () => {
  it("imports card and subject order, first subject appearance wins", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId } })
    const storagePath = await writeWorkbook(deck.id, [
      { subjectName: "S", subjectOrder: 10, front: "f1", back: "b1", cardOrder: 2 },
      { subjectName: "S", subjectOrder: 99, front: "f2", back: "b2", cardOrder: 1 },
    ])
    await queueSpreadsheetImport({ userId, deckId: deck.id, storagePath })
    await runNextWorkerJob(prisma)

    const subject = await prisma.subject.findFirstOrThrow({ where: { deckId: deck.id } })
    expect(subject.order).toBe(10) // first appearance wins, not 99
    const cards = await prisma.card.findMany({
      where: { deckId: deck.id },
      orderBy: { front: "asc" },
      select: { front: true, order: true },
    })
    expect(cards).toEqual([
      { front: "f1", order: 2 },
      { front: "f2", order: 1 },
    ])
  })

  it("export includes subjectOrder and cardOrder columns", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId } })
    const subject = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: "S",
        subjectKey: subjectKeyFor("S"),
        randomKey: 1,
        order: 3,
      },
    })
    await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "f",
        frontHash: hashFront("f"),
        back: "b",
        order: 7,
      },
    })
    const { buffer } = await buildDeckSpreadsheetExport(prisma, userId, deck.id)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet("Card")!
    const header = sheet.getRow(1).values as string[]
    expect(header).toContain("subjectOrder")
    expect(header).toContain("cardOrder")
    const dataRow = sheet.getRow(2)
    const colOf = (name: string) => (header as string[]).indexOf(name)
    expect(dataRow.getCell(colOf("subjectOrder")).text).toBe("3")
    expect(dataRow.getCell(colOf("cardOrder")).text).toBe("7")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test -- deck-spreadsheet.test.ts`
Expected: FAIL — new columns not parsed/written; subject order absent.

- [ ] **Step 3: Update `workbook.ts`**

Change `SpreadsheetRow` and `CARD_HEADERS`:

```ts
export type SpreadsheetRow = {
  rowNumber: number
  id: string
  subjectName: string
  subjectOrder: number | null
  front: string
  back: string
  cardOrder: number | null
  tagNames: string[]
}

export const CARD_HEADERS = [
  "id",
  "subjectName",
  "subjectOrder",
  "front",
  "back",
  "cardOrder",
  "tags",
] as const
```

In `readCardRows`, read the new cells and include them in the empty-row skip and the pushed row:

```ts
const id = cellText(row, columns.id)
const subjectName = cellText(row, columns.subjectName)
const subjectOrder = cellText(row, columns.subjectOrder)
const front = cellText(row, columns.front)
const back = cellText(row, columns.back)
const cardOrder = cellText(row, columns.cardOrder)
const tags = cellText(row, columns.tags)

if (!id && !subjectName && !subjectOrder && !front && !back && !cardOrder && !tags) continue

rows.push({
  rowNumber,
  id,
  subjectName,
  subjectOrder: parseOrderCell(subjectOrder, rowNumber, "subjectOrder"),
  front,
  back,
  cardOrder: parseOrderCell(cardOrder, rowNumber, "cardOrder"),
  tagNames: tags.trim()
    ? tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [],
})
```

Add the parse helper near the bottom of `workbook.ts`:

```ts
function parseOrderCell(text: string, rowNumber: number, column: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value)) {
    throw new Error(`Row ${rowNumber}: ${column} must be a whole number.`)
  }
  return value
}
```

- [ ] **Step 4: Update export in `index.ts`**

In `buildDeckSpreadsheetExport`, change the card query to order by `(order, createdAt)` and select subject order:

```ts
const cards = await prisma.card.findMany({
  where: { deckId },
  orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  include: {
    subject: { select: { subject: true, order: true } },
    cardTags: { include: { tag: { select: { id: true, name: true } } } },
  },
})
```

Change the row write to include order columns:

```ts
cardSheet.addRow([
  card.id,
  card.subject.subject,
  card.subject.order ?? "",
  card.front,
  card.back,
  card.order ?? "",
  card.cardTags
    .map((cardTag) => cardTag.tag.name)
    .sort()
    .join(", "),
])
```

Update the column widths to 7 columns:

```ts
cardSheet.columns = [
  { width: 28 },
  { width: 24 },
  { width: 12 },
  { width: 48 },
  { width: 48 },
  { width: 12 },
  { width: 28 },
]
```

- [ ] **Step 5: Update import in `import-rows.ts`**

At the top of `applySpreadsheetRows`, add a per-subject order map:

```ts
const subjectOrderByKey = new Map<string, number | null>()
```

Change `upsertSubjectForImport` to accept and apply an order (create AND update):

```ts
async function upsertSubjectForImport(
  prisma: Prisma.TransactionClient,
  userId: string,
  deckId: string,
  subjectName: string,
  order: number | null
) {
  const subject = subjectName.trim()
  if (!subject) {
    throw new Error("subjectName is required.")
  }

  const subjectKey = subjectKeyFor(subject)
  const existing = await prisma.subject.findUnique({
    where: { deckId_subjectKey: { deckId, subjectKey } },
    select: { id: true },
  })

  if (existing) {
    await prisma.subject.update({ where: { id: existing.id }, data: { order } })
    return existing
  }

  return prisma.subject.create({
    data: {
      userId,
      deckId,
      subject,
      subjectKey,
      randomKey: randomSubjectKey(),
      order,
    },
    select: { id: true },
  })
}
```

In `applySpreadsheetRows`, add a helper to resolve "first appearance wins" and pass it through both `upsertSubjectForImport` call sites, and set `order` on card create/update. Add this near the top of the function body:

```ts
const resolveSubjectOrder = (name: string, rowOrder: number | null) => {
  const key = subjectKeyFor(name)
  if (!subjectOrderByKey.has(key)) subjectOrderByKey.set(key, rowOrder)
  return subjectOrderByKey.get(key) ?? null
}
```

For the create branch (new card, `!row.id`):

```ts
const subject = await upsertSubjectForImport(
  prisma,
  input.userId,
  input.deckId,
  row.subjectName,
  resolveSubjectOrder(row.subjectName, row.subjectOrder)
)
```

and add `order: row.cardOrder,` to the `prisma.card.create` `data`.

For the update branch, resolve the subject order before the no-op guard so subject order still applies, and include `order` in the card change detection + update data:

```ts
const resolvedSubjectOrder = resolveSubjectOrder(row.subjectName, row.subjectOrder)
const subject =
  card.subject.subject === row.subjectName
    ? await prisma.subject.update({
        where: { id: card.subjectId },
        data: { order: resolvedSubjectOrder },
        select: { id: true, subject: true },
      })
    : await upsertSubjectForImport(
        prisma,
        input.userId,
        input.deckId,
        row.subjectName,
        resolvedSubjectOrder
      )
```

Then update the change detection and write:

```ts
const orderChanged = card.order !== row.cardOrder
const subjectChanged = card.subjectId !== subject.id
const cardFieldsChanged = card.front !== row.front || card.back !== row.back
const tagIdSet = new Set(tagIds)
const tagsChanged =
  currentTagIds.length !== tagIds.length || currentTagIds.some((tagId) => !tagIdSet.has(tagId))

if (!subjectChanged && !cardFieldsChanged && !tagsChanged && !orderChanged) continue
```

and add `order: row.cardOrder,` to the `prisma.card.update` `data`. Also include `order: true` in the existing-card `findFirst` select so `card.order` is available:

```ts
const card = await prisma.card.findFirst({
  where: { id: row.id, deckId: input.deckId, deck: { userId: input.userId } },
  include: {
    subject: { select: { id: true, subject: true } },
    cardTags: { select: { tagId: true } },
  },
})
```

Change to also select `order` on the card (the `findFirst` above uses `include`, which returns scalar fields including `order` by default — no change needed; `card.order` is already present). Verify by typecheck.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter server test -- deck-spreadsheet.test.ts`
Expected: PASS (existing import tests still green; new order tests pass).

---

## Task 9: Client — Options submenu + Sequential checkbox

**Files:**

- Modify: `packages/client/src/domains/decks/deck-detail.page/index.tsx`

- [ ] **Step 1: Add sequential state synced from the deck**

Near the other settings state, add:

```tsx
const [sequentialEnabled, setSequentialEnabled] = useState(false)
const [optionsExpanded, setOptionsExpanded] = useState(false)
```

In the existing `useEffect` that syncs `deck.data` to local state (the one setting `speechRecognitionEnabled`/`inverseReviewEnabled`), add:

```tsx
setSequentialEnabled(deck.data.sequentialEnabled)
```

In the `updateReviewSettings` mutation's `onMutate` optimistic updater, extend the merged object with:

```tsx
              sequentialEnabled: input.sequentialEnabled ?? current.sequentialEnabled,
```

and in its `onError` rollback, add:

```tsx
setSequentialEnabled(context.previousDeck.sequentialEnabled)
```

Add a debounced effect mirroring the speech/inverse effects:

```tsx
useEffect(() => {
  if (!deck.data) return
  if (sequentialEnabled === deck.data.sequentialEnabled) return
  const timeoutId = window.setTimeout(() => {
    updateReviewSettings.mutate({ id: deckId, sequentialEnabled })
  }, 300)
  return () => window.clearTimeout(timeoutId)
}, [deck.data, deckId, sequentialEnabled, updateReviewSettings])
```

- [ ] **Step 2: Add the Options menu item with inline submenu**

Import a chevron at the top (extend the existing `lucide-react` import): add `ChevronRight`, `ChevronDown`.

In `menuItems`, immediately after the "Edit deck" `MenuItem`, insert:

```tsx
;<MenuItem
  icon={
    optionsExpanded ? (
      <ChevronDown className="h-[18px] w-[18px]" />
    ) : (
      <ChevronRight className="h-[18px] w-[18px]" />
    )
  }
  onSelect={() => setOptionsExpanded((v) => !v)}
>
  Options
</MenuItem>
{
  optionsExpanded && (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 pl-6 text-[15px] font-medium transition-colors hover:bg-accent/70">
      <span>Sequential deck</span>
      <input
        type="checkbox"
        checked={sequentialEnabled}
        onChange={(e) => setSequentialEnabled(e.target.checked)}
        className="h-4 w-4"
      />
    </label>
  )
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm --filter client lint`
Expected: PASS. Manual: open a deck, open the menu, expand Options, toggle Sequential deck; reload and confirm it persisted.

---

## Task 10: Client — single Review button for sequential decks

**Files:**

- Modify: `packages/client/src/domains/decks/deck-detail.page/index.tsx`

- [ ] **Step 1: Branch the review entry buttons**

Replace the existing review-button block (the `{dueCount > 0 ? ... : ...}` inside `<div className="flex flex-col gap-2">`) with:

```tsx
<div className="flex flex-col gap-2">
  {deck.data.sequentialEnabled ? (
    <Link
      to="/decks/$deckId/review"
      params={{ deckId }}
      className={cn(buttonVariants({ variant: "default" }))}
    >
      Review
    </Link>
  ) : dueCount > 0 ? (
    <Link
      to="/decks/$deckId/review"
      params={{ deckId }}
      className={cn(buttonVariants({ variant: "default" }))}
    >
      Review {dueCount} due
    </Link>
  ) : (
    <Link
      to="/decks/$deckId/review/free"
      params={{ deckId }}
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      Free review (no cards due)
    </Link>
  )}
</div>
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS. Manual: a sequential deck shows a single "Review" button.

---

## Task 11: Client — sequential branch in ReviewPage

**Files:**

- Create: `packages/client/src/domains/review/review-sequential.page.tsx`
- Modify: `packages/client/src/domains/review/review.page.tsx`

**Rationale:** `review.page.tsx` is already dense and inverse-specific. Put the sequential walk in its own component and dispatch to it from `ReviewPage` when `deck.sequentialEnabled` and we are in normal (non-subject, non-card-pinned) review. This keeps each file focused.

- [ ] **Step 1: Create the sequential page component**

Create `packages/client/src/domains/review/review-sequential.page.tsx`:

```tsx
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, Pencil, RotateCcw } from "lucide-react"
import {
  buttonsForPrevious,
  COOLDOWN_LABEL,
  FIXATION_EMOJI,
  FIXATION_LEVELS,
  type FixationLevel,
} from "@cards/shared/fixation"
import { trpc } from "../../infra/trpc"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../lib/utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { displayFrontWithGeneratedTagPrefix } from "../cards/card-front-prefix"

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}

export function ReviewSequentialPage() {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [cardId, setCardId] = useState<string | undefined>(undefined)
  const [move, setMove] = useState<"resume" | "next" | "prev" | "first">("resume")
  const [revealed, setRevealed] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  const query = trpc.review.sequential.useQuery(
    { deckId, cardId, move },
    { refetchOnWindowFocus: false, staleTime: 0 }
  )

  const data = query.data
  const card = data?.card ?? null

  useEffect(() => {
    if (card) setCardId(card.id)
  }, [card])

  useEffect(() => {
    setRevealed(false)
  }, [card?.id])

  const goTo = (nextMove: "next" | "prev" | "first") => {
    if (nextMove === "first") {
      setCardId(undefined)
      setMove("first")
    } else {
      setMove(nextMove)
    }
  }

  const advance = trpc.review.advance.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
      goTo("next")
    },
  })

  const complete = trpc.review.complete.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
      utils.decks.upcomingDueCounts.invalidate({ id: deckId })
      utils.decks.reviewStats.invalidate({ id: deckId })
      goTo("next")
    },
  })

  if (query.isLoading) return <p></p>

  if (!card) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Reached the end</h1>
        <p className="text-sm text-muted-foreground">You have gone through every card.</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => goTo("first")}>Restart</Button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline" }))}
            onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
          >
            Back to deck
          </button>
        </div>
      </div>
    )
  }

  const prev = FIXATION_LEVELS.includes(card.subject.fixationLevel as FixationLevel)
    ? (card.subject.fixationLevel as FixationLevel)
    : "1"
  const options = buttonsForPrevious(prev)
  const promptSource = displayFrontWithGeneratedTagPrefix(card.front, card.tags)
  const pending = advance.isPending || complete.isPending

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        subtitle={card.subject.subject}
        onBack={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
        actions={
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous card"
              disabled={!data?.hasPrev || pending}
              onClick={() => goTo("prev")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Restart"
              onClick={() => setRestartOpen(true)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit card"
              onClick={() =>
                navigate({
                  to: "/decks/$deckId/cards/$cardId/edit",
                  params: { deckId, cardId: card.id },
                  search: { returnToReviewCard: true, reviewMode: "normal" },
                })
              }
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div key={card.id} className="contents [&>*]:animate-card-in">
        <Card>
          <CardContent className="min-h-[8rem] p-4">
            <MarkdownView source={promptSource} />
          </CardContent>
        </Card>
      </div>

      {revealed ? (
        <>
          <Card className="animate-reveal">
            <CardContent className="min-h-[8rem] p-4">
              <MarkdownView source={card.back} />
            </CardContent>
          </Card>
          {data?.isLastInSubject ? (
            <div className="mt-auto grid grid-cols-4 gap-2 animate-reveal">
              {options.map((lvl: FixationLevel) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={pending}
                  onClick={() => complete.mutate({ cardId: card.id, chosenLevel: lvl })}
                  aria-label={`${lvl} - ${COOLDOWN_LABEL[lvl]}`}
                  className={cn(
                    "flex h-20 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50",
                    LEVEL_COLOR[lvl]
                  )}
                >
                  <span className="text-3xl leading-none">{FIXATION_EMOJI[lvl]}</span>
                  <span className="text-sm opacity-90">{COOLDOWN_LABEL[lvl]}</span>
                </button>
              ))}
            </div>
          ) : (
            <Button
              className="mt-auto w-full animate-reveal gap-1.5"
              disabled={pending}
              onClick={() => advance.mutate({ cardId: card.id })}
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </>
      ) : (
        <Button className="mt-auto w-full" onClick={() => setRevealed(true)}>
          Reveal
        </Button>
      )}

      <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart this deck?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Jump back to the first card. Your progress and stats are not changed.
          </p>
          <div className="mt-4 flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="flex-1"
              onClick={() => {
                setRestartOpen(false)
                goTo("first")
              }}
            >
              Restart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Dispatch from ReviewPage**

In `review.page.tsx`, import the new page and the deck query is already present (`deck`). At the top of `ReviewPage`, after the `deck` query is defined, add an early dispatch — but only for the plain normal walk (not subject-pinned or card-pinned, where the existing single-card behavior must stay):

```tsx
if (deck.data?.sequentialEnabled && !initialSubjectId && !initialCardId && mode === "normal") {
  return <ReviewSequentialPage />
}
```

Add the import at the top:

```tsx
import { ReviewSequentialPage } from "./review-sequential.page"
```

Note: this `if` must be placed after all hooks are declared (React hooks rules) — put it immediately before the `if (next.isLoading ...)` guard, not before the hooks.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm --filter client lint`
Expected: PASS. Manual: open Review on a sequential deck → walk with Next, fixation on last card of a subject, Prev, Restart (confirm dialog), end-of-deck screen.

---

## Task 12: Client — reorder buttons in subject detail

**Files:**

- Modify: `packages/client/src/domains/subjects/subject-cards.page.tsx`

- [ ] **Step 1: Add the reorder mutation and pass sequential + position into the item**

In `SubjectCardsPage`, add:

```tsx
const reorderCard = trpc.subjects.reorderCard.useMutation({
  onSuccess: () => {
    utils.subjects.get.invalidate({ id: subjectId })
    utils.review.sequential.invalidate()
  },
})
```

Add `import { ArrowDown, ArrowUp }` to the existing `lucide-react` import.

Change the `cards.map` render to pass index/length/sequential/handlers:

```tsx
{
  cards.map((card, index) => (
    <li key={card.id}>
      <SubjectCardItem
        card={card}
        isRegenerating={regeneratingId === card.id}
        actionsDisabled={actionsDisabled}
        sequential={Boolean(deck.data?.sequentialEnabled)}
        canMoveUp={index > 0}
        canMoveDown={index < cards.length - 1}
        onMoveUp={() => reorderCard.mutate({ cardId: card.id, direction: "up" })}
        onMoveDown={() => reorderCard.mutate({ cardId: card.id, direction: "down" })}
        onRegenerate={() => regenerate(card)}
        onRemove={() => removeCard(card)}
        onSave={(front, back) => saveCard(card, front, back)}
      />
    </li>
  ))
}
```

- [ ] **Step 2: Render up/down buttons before trash**

Extend `SubjectCardItem`'s props:

```tsx
function SubjectCardItem({
  card,
  isRegenerating,
  actionsDisabled,
  sequential,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRegenerate,
  onRemove,
  onSave,
}: {
  card: SubjectCardData
  isRegenerating: boolean
  actionsDisabled: boolean
  sequential: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRegenerate: () => void
  onRemove: () => void
  onSave: (front: string, back: string) => Promise<void>
}) {
```

In the non-editing actions block (the `<>...</>` that holds regenerate + trash), insert before the trash `Button`:

```tsx
{
  sequential && (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move card up"
        disabled={actionsDisabled || !canMoveUp}
        onClick={onMoveUp}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move card down"
        disabled={actionsDisabled || !canMoveDown}
        onClick={onMoveDown}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </>
  )
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm --filter client lint`
Expected: PASS. Manual: in a sequential deck's subject page, up/down reorder cards and persist; non-sequential deck shows no reorder buttons.

---

## Task 13: Playwright e2e — sequential walk

**Files:**

- Modify: `packages/client/e2e/happy-path.spec.ts` (or create `packages/client/e2e/sequential.spec.ts` following the existing spec's setup/login helpers)

- [ ] **Step 1: Read the existing spec**

Run: `sed -n '1,80p' packages/client/e2e/happy-path.spec.ts`
Expected: understand the existing signup/deck-create/add-card/review helpers and selectors (`data-testid`, button text).

- [ ] **Step 2: Add a sequential scenario**

Add a test that: signs up (reuse helper), creates a deck, adds two cards under one subject and one under another, enables Sequential deck via the menu → Options → checkbox, opens Review, asserts the first card prompt, clicks **Reveal** then **Next** (for non-last cards), asserts fixation buttons appear on a subject's last card, clicks a fixation button, then uses **Prev** to go back one card, and opens **Restart** confirming the dialog returns to the first card. Use role/text selectors consistent with the existing spec (e.g. `getByRole("button", { name: "Next" })`, `getByLabel("Previous card")`, `getByLabel("Restart")`).

Concrete assertions to include:

- After enabling sequential, the deck detail shows a single button named exactly `Review`.
- On the last card of a subject, `getByRole("button", { name: /min|h|d|w/ })` fixation buttons are visible (or assert the `Next` button is NOT present).
- After Restart confirmation, the first subject's first card prompt is shown again.

- [ ] **Step 3: Run e2e**

Run: `rm -f packages/server/prisma/e2e.db && pnpm test:e2e`
Expected: PASS (delete the sticky e2e DB first, per project notes).

---

## Task 14: Format + full QA gate

- [ ] **Step 1: Format the whole repo**

Run: `pnpm format`
Expected: files rewritten to Prettier style (printWidth 100, no semicolons).

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && rm -f packages/server/prisma/e2e.db && pnpm test:e2e`
Expected: ALL PASS.

- [ ] **Step 3: Leave changes uncommitted**

Do NOT commit. Report a summary of changed files and the green gate output to the user for review.

---

## Self-review notes (coverage map)

- Deck flag + default false → Tasks 1, 2, 3.
- Order columns on Card/Subject → Task 1.
- Ordering `(order, createdAt)` nulls last → Tasks 4, 6, 7, 8 (export).
- Options submenu below Edit deck → Task 9.
- Single Review button (sequential) → Task 10.
- Walk all cards of a subject; Next vs fixation on last; Next = lastSeen only → Tasks 5, 11.
- Resume from last seen / first → Task 6, 11.
- Prev + Restart (confirm, no writes) → Task 6 (`prev`/`first`), 11.
- No inverse review in sequential branch → Task 11 (separate component, no inverse).
- Reorder up/down in subject detail (sequential only) → Tasks 7, 12.
- XLS subjectOrder/cardOrder, first-appearance-wins → Task 8.
- QA: typecheck/lint/vitest/e2e → Tasks 3–8 (unit), 13 (e2e), 14 (gate).

```

```
