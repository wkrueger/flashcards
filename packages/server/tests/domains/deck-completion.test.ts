import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
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
