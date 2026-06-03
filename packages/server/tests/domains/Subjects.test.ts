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
    const c1 = await addCard(deck.id, subject.id, "null-a", null)
    const c2 = await addCard(deck.id, subject.id, "ord-2", 2)
    const c3 = await addCard(deck.id, subject.id, "ord-1", 1)
    const c4 = await addCard(deck.id, subject.id, "null-b", null)

    const result = await callerFor(userId).subjects.get({ id: subject.id })
    expect(result.cards.map((c) => c.id)).toEqual([c3.id, c2.id, c1.id, c4.id])
  })
})

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
