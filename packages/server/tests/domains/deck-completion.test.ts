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
