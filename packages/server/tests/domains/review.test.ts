import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { pickNextCard } from "../../src/domains/review/review.service.js"
import {
  SUBJECT_RANDOM_KEY_RANGE,
  subjectKeyFor,
} from "../../src/domains/subjects/subjects.service.js"
import { COOLDOWN_MS } from "@cards/shared"
import { tagOwnershipFor } from "../../src/domains/cards/cards.service.js"

async function seedSubjects(
  userId: string,
  deckId: string,
  specs: {
    text: string
    cooldownAt: Date
    lastSeenAt?: Date
    fixationLevel?: string
    inverseReviewed?: boolean
    tags?: string[]
  }[]
) {
  for (const [index, s] of specs.entries()) {
    const subj = await prisma.subject.create({
      data: {
        deckId,
        userId,
        subject: s.text,
        subjectKey: subjectKeyFor(s.text),
        randomKey: Math.floor((index / specs.length) * SUBJECT_RANDOM_KEY_RANGE),
        cooldownAt: s.cooldownAt,
        lastSeenAt: s.lastSeenAt,
        fixationLevel: s.fixationLevel,
        inverseReviewed: s.inverseReviewed,
      },
    })
    await prisma.card.create({
      data: {
        deckId,
        subjectId: subj.id,
        front: `front-${s.text}`,
        frontHash: s.text,
        back: `back-${s.text}`,
        cardTags: s.tags
          ? {
              create: s.tags.map((name) => {
                const ownership = tagOwnershipFor(userId, name)

                return {
                  tag: {
                    connectOrCreate: {
                      where: {
                        ownerKey_name: {
                          ownerKey: ownership.ownerKey,
                          name,
                        },
                      },
                      create: {
                        ...ownership,
                        name,
                      },
                    },
                  },
                }
              }),
            }
          : undefined,
      },
    })
  }
}

describe("review domain", () => {
  beforeEach(async () => {
    await resetDomain()
  })

  it("normal mode returns null when nothing due", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const future = new Date(Date.now() + 60_000)
    await seedSubjects(u, deck.id, [{ text: "x", cooldownAt: future }])

    const r = await callerFor(u).review.next({ mode: "normal" })
    expect(r.card).toBeNull()
  })

  it("normal mode mixes recent subjects with random subjects outside the recents list", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const past = (mins: number) => new Date(Date.now() - mins * 60_000)
    // 10 subjects all due, with s0..s3 as the four most recently seen subjects.
    const specs = Array.from({ length: 10 }, (_, i) => ({
      text: `s${i}`,
      cooldownAt: past(100 - i), // s0 oldest, s9 newest
      lastSeenAt: past(i),
    }))
    await seedSubjects(u, deck.id, specs)

    const recent = await pickNextCard({
      prisma,
      userId: u,
      includeOnCooldown: false,
      rng: () => 0,
    })
    expect(recent.card?.subject.subject).toBe("s0")

    const randomOutsideRecents = await pickNextCard({
      prisma,
      userId: u,
      includeOnCooldown: false,
      rng: () => 0.99,
    })
    expect(["s4", "s5", "s6", "s7", "s8", "s9"]).toContain(
      randomOutsideRecents.card?.subject.subject
    )
  })

  it("free mode picks even when all subjects are on cooldown", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const future = (mins: number) => new Date(Date.now() + mins * 60_000)
    await seedSubjects(u, deck.id, [
      { text: "a", cooldownAt: future(60) },
      { text: "b", cooldownAt: future(120) },
      { text: "c", cooldownAt: future(180) },
    ])

    const r = await callerFor(u).review.next({ mode: "free" })
    expect(r.card).not.toBeNull()
  })

  it("returns inverse=true when deck has inverseReviewEnabled and roll succeeds", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [{ text: "Haus", cooldownAt: new Date(Date.now() - 1000) }])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0,
    })
    expect(r.inverse).toBe(true)
  })

  it("returns inverse=false when deck flag is off even on a winning roll", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    await seedSubjects(u, deck.id, [{ text: "Haus", cooldownAt: new Date(Date.now() - 1000) }])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0,
    })
    expect(r.inverse).toBe(false)
  })

  it('doubles inverse chance when the chosen subject fixation is "1"', async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [
      {
        text: "Haus",
        cooldownAt: new Date(Date.now() - 1000),
        lastSeenAt: new Date(Date.now() - 60_000),
        fixationLevel: "1",
      },
    ])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0.39,
    })
    expect(r.inverse).toBe(true)
  })

  it('multiplies inverse chance by 1.5 when the chosen subject fixation is "2"', async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [
      {
        text: "Haus",
        cooldownAt: new Date(Date.now() - 1000),
        lastSeenAt: new Date(Date.now() - 60_000),
        fixationLevel: "2",
      },
    ])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0.29,
    })
    expect(r.inverse).toBe(true)
  })

  it('uses 0.7 inverse chance when the chosen card has the "gen:bigger" tag', async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [
      {
        text: "Haus",
        cooldownAt: new Date(Date.now() - 1000),
        fixationLevel: "5",
        tags: ["gen:bigger"],
      },
    ])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0.69,
    })
    expect(r.inverse).toBe(true)
  })

  it("does not return inverse review when the chosen subject was already inverse reviewed", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [
      {
        text: "Haus",
        cooldownAt: new Date(Date.now() - 1000),
        fixationLevel: "1",
        inverseReviewed: true,
        tags: ["gen:bigger"],
      },
    ])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0,
    })
    expect(r.inverse).toBe(false)
  })

  it("reduces inverse chance after a prior inverse review in the same deck", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "f",
      back: "b",
    })

    await trpc.review.complete({ cardId: card.id, inverse: true })

    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0.15,
    })
    expect(r.inverse).toBe(false)
  })

  it('swaps a "gen:meaning" card for a sibling and reviews it normally after inverse review', async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    const subject = await prisma.subject.create({
      data: {
        userId: u,
        deckId: deck.id,
        subject: "Haus",
        subjectKey: subjectKeyFor("Haus"),
        randomKey: 0,
        cooldownAt: new Date(Date.now() - 1000),
        fixationLevel: "5",
        inverseReviewed: true,
      },
    })
    const ownership = tagOwnershipFor(u, "gen:meaning")
    await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "front-meaning",
        frontHash: "meaning",
        back: "back-meaning",
        cardTags: {
          create: [
            {
              tag: {
                connectOrCreate: {
                  where: {
                    ownerKey_name: {
                      ownerKey: ownership.ownerKey,
                      name: "gen:meaning",
                    },
                  },
                  create: { ...ownership, name: "gen:meaning" },
                },
              },
            },
          ],
        },
      },
    })
    await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "front-basic",
        frontHash: "basic",
        back: "back-basic",
      },
    })
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0,
    })
    expect(r.inverse).toBe(false)
    expect(r.card?.front).toBe("front-basic")
  })

  it('keeps the original "gen:meaning" card in normal mode when no sibling card exists', async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({
      name: "d",
      inverseReviewEnabled: true,
    })
    await seedSubjects(u, deck.id, [
      {
        text: "Haus",
        cooldownAt: new Date(Date.now() - 1000),
        fixationLevel: "5",
        inverseReviewed: true,
        tags: ["gen:meaning"],
      },
    ])
    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      inverseRng: () => 0,
    })
    expect(r.inverse).toBe(false)
    expect(r.card?.tags).toEqual(["gen:meaning"])
  })

  it("inverse complete only updates lastSeenAt", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d", inverseReviewEnabled: true })
    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "f",
      back: "b",
    })
    const subjBefore = await prisma.subject.findFirstOrThrow({
      where: { userId: u, subject: "Haus" },
    })
    await trpc.review.complete({ cardId: card.id, inverse: true })
    const subjAfter = await prisma.subject.findFirstOrThrow({
      where: { id: subjBefore.id },
    })
    expect(subjAfter.timesSeen).toBe(subjBefore.timesSeen)
    expect(subjAfter.fixationLevel).toBe(subjBefore.fixationLevel)
    expect(subjAfter.inverseReviewed).toBe(true)
    expect(subjAfter.cooldownAt.getTime()).toBe(subjBefore.cooldownAt.getTime())
    expect(subjAfter.lastSeenAt).not.toBeNull()
    const deckAfter = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(deckAfter.inverseReviewStreak).toBe(1)
    const cardAfter = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    expect(cardAfter.timesSeen).toBe(0)
    expect(cardAfter.lastSeenAt).not.toBeNull()
  })

  it("complete advances cooldown by the chosen level", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "f",
      back: "b",
    })

    const before = Date.now()
    await trpc.review.complete({ cardId: card.id, chosenLevel: "3" })
    const subj = await prisma.subject.findFirstOrThrow({
      where: { userId: u, subject: "Haus" },
    })
    const after = Date.now()
    const expectedMin = before + COOLDOWN_MS["3"] - 1000
    const expectedMax = after + COOLDOWN_MS["3"] + 1000
    expect(subj.cooldownAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(subj.cooldownAt.getTime()).toBeLessThanOrEqual(expectedMax)
    expect(subj.fixationLevel).toBe("3")
    expect(subj.inverseReviewed).toBe(false)
    expect(subj.timesSeen).toBe(1)
    const deckAfter = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })
    expect(deckAfter.inverseReviewStreak).toBe(0)

    const reloaded = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    expect(reloaded.timesSeen).toBe(1)
    expect(reloaded.lastSeenAt).not.toBeNull()
  })

  it("non-inverse complete records cardMinutes and cardCount against today's deck stats", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    const cardA = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "alpha",
      front: "fa",
      back: "ba",
    })
    const cardB = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "beta",
      front: "fb",
      back: "bb",
    })

    await trpc.review.complete({ cardId: cardA.id, chosenLevel: "3" })
    await trpc.review.complete({ cardId: cardB.id, chosenLevel: "5" })

    const stats = await prisma.reviewStat.findMany({ where: { deckId: deck.id } })
    expect(stats).toHaveLength(1)
    const expected = Math.round(COOLDOWN_MS["3"] / 60_000) + Math.round(COOLDOWN_MS["5"] / 60_000)
    expect(stats[0]!.cardMinutes).toBe(expected)
    expect(stats[0]!.cardCount).toBe(2)
  })

  it("inverse complete does not record stats", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d", inverseReviewEnabled: true })
    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "f",
      back: "b",
    })
    await trpc.review.complete({ cardId: card.id, inverse: true })
    const stats = await prisma.reviewStat.findMany({ where: { deckId: deck.id } })
    expect(stats).toHaveLength(0)
  })

  it("inverse complete in mixed sequence does not increment cardCount", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d", inverseReviewEnabled: true })
    const cardA = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "alpha",
      front: "fa",
      back: "ba",
    })
    const cardB = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "beta",
      front: "fb",
      back: "bb",
    })

    await trpc.review.complete({ cardId: cardA.id, chosenLevel: "3" })
    await trpc.review.complete({ cardId: cardB.id, inverse: true })
    await trpc.review.complete({ cardId: cardB.id, chosenLevel: "2" })

    const stats = await prisma.reviewStat.findMany({ where: { deckId: deck.id } })
    expect(stats).toHaveLength(1)
    expect(stats[0]!.cardCount).toBe(2)
  })

  it("complete prunes review stats older than 15 days", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "x",
      front: "f",
      back: "b",
    })
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await prisma.reviewStat.create({
      data: { deckId: deck.id, date: stale, cardMinutes: 99 },
    })

    await trpc.review.complete({ cardId: card.id, chosenLevel: "3" })

    const stats = await prisma.reviewStat.findMany({ where: { deckId: deck.id } })
    expect(stats.find((s) => s.date.getTime() === stale.getTime())).toBeUndefined()
  })

  it("subjectId pin returns a card from that subject even when on cooldown", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const future = (mins: number) => new Date(Date.now() + mins * 60_000)
    await seedSubjects(u, deck.id, [
      { text: "alpha", cooldownAt: future(60) },
      { text: "beta", cooldownAt: future(120) },
    ])
    const beta = await prisma.subject.findFirstOrThrow({ where: { userId: u, subject: "beta" } })

    const r = await callerFor(u).review.next({
      mode: "normal",
      deckId: deck.id,
      subjectId: beta.id,
    })

    expect(r.card?.subject.subject).toBe("beta")
  })

  it("subjectId pin with excludeCardId picks a different card from the same subject", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const subject = await prisma.subject.create({
      data: {
        userId: u,
        deckId: deck.id,
        subject: "Haus",
        subjectKey: subjectKeyFor("Haus"),
        randomKey: 0,
        cooldownAt: new Date(Date.now() + 60_000),
      },
    })
    const cardA = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "a-front",
        frontHash: "a",
        back: "a-back",
      },
    })
    await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "b-front",
        frontHash: "b",
        back: "b-back",
      },
    })

    const r = await callerFor(u).review.next({
      mode: "normal",
      deckId: deck.id,
      subjectId: subject.id,
      excludeCardId: cardA.id,
    })

    expect(r.card?.id).not.toBe(cardA.id)
    expect(r.card?.subject.subject).toBe("Haus")
  })

  it("uses base inverse probability when the chosen subject has never been seen", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d", inverseReviewEnabled: true })
    await seedSubjects(u, deck.id, [
      { text: "Haus", cooldownAt: new Date(Date.now() - 1000), fixationLevel: "1" },
    ])
    const subj = await prisma.subject.findFirstOrThrow({ where: { userId: u, subject: "Haus" } })

    const r = await pickNextCard({
      prisma,
      userId: u,
      deckId: deck.id,
      includeOnCooldown: false,
      subjectId: subj.id,
      inverseRng: () => 0.5,
    })

    expect(r.inverse).toBe(false)
    expect(r.card?.subject.subject).toBe("Haus")
  })
})
