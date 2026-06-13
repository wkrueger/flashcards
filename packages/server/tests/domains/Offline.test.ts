import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { COOLDOWN_MS, nextCooldownAt } from "@cards/shared"
import { subjectKeyFor } from "../../src/domains/Subjects/subjectsService.js"
import { tagOwnershipFor } from "../../src/domains/Cards/cardsService.js"

async function makeDeck(userId: string, name = "deck") {
  return prisma.deck.create({ data: { userId, name } })
}

async function makeSubjectWithCard(
  userId: string,
  deckId: string,
  text: string,
  tags: string[] = []
) {
  const subject = await prisma.subject.create({
    data: { deckId, userId, subject: text, subjectKey: subjectKeyFor(text), randomKey: 1 },
  })
  const card = await prisma.card.create({
    data: {
      deckId,
      subjectId: subject.id,
      front: `front-${text}`,
      frontHash: text,
      back: `back-${text}`,
      cardTags: {
        create: tags.map((name) => {
          const ownership = tagOwnershipFor(userId, name)
          return {
            tag: {
              connectOrCreate: {
                where: { ownerKey_name: { ownerKey: ownership.ownerKey, name } },
                create: { ownerType: ownership.ownerType, ownerKey: ownership.ownerKey, name },
              },
            },
          }
        }),
      },
    },
  })
  return { subject, card }
}

beforeEach(resetDomain)

describe("offline.snapshot", () => {
  it("returns deck config, subjects and cards with tags", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    const { card } = await makeSubjectWithCard(userId, deck.id, "alpha", ["gen:meaning"])

    const snap = await callerFor(userId).offline.snapshot({ deckId: deck.id })

    expect(snap.deck.id).toBe(deck.id)
    expect(snap.deck.name).toBe("deck")
    expect(snap.subjects).toHaveLength(1)
    expect(snap.subjects[0]!.subject).toBe("alpha")
    expect(snap.cards).toHaveLength(1)
    expect(snap.cards[0]!.id).toBe(card.id)
    expect(snap.cards[0]!.tags).toEqual(["gen:meaning"])
    expect(typeof snap.fetchedAt).toBe("string")
  })

  it("does not leak another user's deck", async () => {
    const owner = await makeUser("owner")
    const intruder = await makeUser("intruder")
    const deck = await makeDeck(owner)

    await expect(callerFor(intruder).offline.snapshot({ deckId: deck.id })).rejects.toThrow()
  })
})

describe("offline.syncReviews", () => {
  it("replays in completedAt order; cooldown reflects the latest review per subject", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    const { subject, card } = await makeSubjectWithCard(userId, deck.id, "alpha")

    const earlier = new Date("2026-06-10T10:00:00.000Z")
    const later = new Date("2026-06-10T12:00:00.000Z")

    // Submit out of order; the server must apply `later` last.
    const res = await callerFor(userId).offline.syncReviews({
      reviews: [
        { cardId: card.id, chosenLevel: "5", completedAt: later.toISOString() },
        { cardId: card.id, chosenLevel: "2", completedAt: earlier.toISOString() },
      ],
    })

    expect(res.synced).toBe(2)
    expect(res.skipped).toBe(0)

    const after = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })
    expect(after.fixationLevel).toBe("5")
    expect(after.cooldownAt.getTime()).toBe(nextCooldownAt("5", later).getTime())
    // timesSeen incremented once per replayed review.
    expect(after.timesSeen).toBe(2)
  })

  it("skips reviews whose card no longer exists", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    const { card } = await makeSubjectWithCard(userId, deck.id, "alpha")

    const res = await callerFor(userId).offline.syncReviews({
      reviews: [
        { cardId: card.id, chosenLevel: "3", completedAt: new Date().toISOString() },
        { cardId: "missing-card", chosenLevel: "3", completedAt: new Date().toISOString() },
      ],
    })

    expect(res.synced).toBe(1)
    expect(res.skipped).toBe(1)
    expect(res.results.find((r) => r.cardId === "missing-card")?.reason).toBe("NOT_FOUND")
  })

  it("advance items mark the card seen without changing cooldown", async () => {
    const userId = await makeUser()
    const deck = await makeDeck(userId)
    const { subject, card } = await makeSubjectWithCard(userId, deck.id, "alpha")
    const before = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })

    const seenAt = new Date("2026-06-11T09:00:00.000Z")
    const res = await callerFor(userId).offline.syncReviews({
      reviews: [{ cardId: card.id, advance: true, completedAt: seenAt.toISOString() }],
    })

    expect(res.synced).toBe(1)
    const cardAfter = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    expect(cardAfter.lastSeenAt?.getTime()).toBe(seenAt.getTime())
    const subjectAfter = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } })
    expect(subjectAfter.cooldownAt.getTime()).toBe(before.cooldownAt.getTime())
    expect(subjectAfter.fixationLevel).toBe(before.fixationLevel)
  })

  it("does not let a user sync reviews for another user's card", async () => {
    const owner = await makeUser("owner")
    const intruder = await makeUser("intruder")
    const deck = await makeDeck(owner)
    const { card } = await makeSubjectWithCard(owner, deck.id, "alpha")

    const res = await callerFor(intruder).offline.syncReviews({
      reviews: [{ cardId: card.id, chosenLevel: "3", completedAt: new Date().toISOString() }],
    })

    expect(res.synced).toBe(0)
    expect(res.skipped).toBe(1)
    // Owner's card stays untouched.
    const subjectAfter = await prisma.subject.findFirstOrThrow({ where: { deckId: deck.id } })
    expect(subjectAfter.timesSeen).toBe(0)
    expect(COOLDOWN_MS["3"]).toBeGreaterThan(0)
  })
})
