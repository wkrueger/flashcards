import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { subjectKeyFor } from "../../src/domains/Subjects/subjectsService.js"
import { hashFront } from "../../src/domains/Cards/cardsService.js"

beforeEach(resetDomain)

async function seed(userId: string) {
  const deck = await prisma.deck.create({
    data: { name: "Seq", userId, sequentialEnabled: true },
  })
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

  it("current returns the card at the cursor without advancing", async () => {
    const userId = await makeUser()
    const { deck, a1 } = await seed(userId)
    const res = await callerFor(userId).review.sequential({
      deckId: deck.id,
      cardId: a1.id,
      move: "current",
    })
    expect(res.card?.id).toBe(a1.id)
  })

  it("traverses across null-order subjects with identical createdAt (id tiebreak)", async () => {
    const userId = await makeUser()
    const deck = await prisma.deck.create({ data: { name: "D", userId, sequentialEnabled: true } })
    const sharedCreatedAt = new Date("2026-01-01T00:00:00.000Z")
    // cuid ids are time-ordered, so "a" < "b" lexicographically is not guaranteed;
    // create A then B and rely on their generated ids for the tiebreak.
    const sA = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: "A",
        subjectKey: subjectKeyFor("A"),
        randomKey: 1,
        createdAt: sharedCreatedAt,
      },
    })
    const sB = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: "B",
        subjectKey: subjectKeyFor("B"),
        randomKey: 2,
        createdAt: sharedCreatedAt,
      },
    })
    const a1 = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: sA.id,
        front: "a1",
        frontHash: hashFront("a1"),
        back: "b",
      },
    })
    const b1 = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: sB.id,
        front: "b1",
        frontHash: hashFront("b1"),
        back: "b",
      },
    })
    const caller = callerFor(userId)
    // forward order is deterministic by id
    const first = await caller.review.sequential({ deckId: deck.id, move: "first" })
    const second = await caller.review.sequential({
      deckId: deck.id,
      cardId: first.card!.id,
      move: "next",
    })
    const firstCard = first.card!.id
    const secondCard = second.card!.id
    expect(new Set([firstCard, secondCard])).toEqual(new Set([a1.id, b1.id]))
    // the second card reports hasPrev and prev returns to the first card
    expect(second.hasPrev).toBe(true)
    const back = await caller.review.sequential({
      deckId: deck.id,
      cardId: secondCard,
      move: "prev",
    })
    expect(back.card?.id).toBe(firstCard)
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
