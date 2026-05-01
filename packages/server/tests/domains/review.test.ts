import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import { pickNextCard } from "../../src/domains/review/review.service.js"
import {
  SUBJECT_RANDOM_KEY_RANGE,
  subjectKeyFor,
} from "../../src/domains/subjects/subjects.service.js"
import { COOLDOWN_MS } from "@cards/shared"

async function seedSubjects(
  userId: string,
  deckId: string,
  specs: {
    text: string
    cooldownAt: Date
    lastSeenAt?: Date
    fixationLevel?: string
    tags?: string[]
  }[]
) {
  for (const [index, s] of specs.entries()) {
    const subj = await prisma.subject.create({
      data: {
        userId,
        subject: s.text,
        subjectKey: subjectKeyFor(s.text),
        randomKey: Math.floor((index / specs.length) * SUBJECT_RANDOM_KEY_RANGE),
        cooldownAt: s.cooldownAt,
        lastSeenAt: s.lastSeenAt,
        fixationLevel: s.fixationLevel,
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
              create: s.tags.map((name) => ({
                tag: {
                  connectOrCreate: {
                    where: { userId_name: { userId, name } },
                    create: { userId, name },
                  },
                },
              })),
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

  it("normal mode returns null + dueCount=0 when nothing due", async () => {
    const u = await makeUser("u")
    const deck = await callerFor(u).decks.create({ name: "d" })
    const future = new Date(Date.now() + 60_000)
    await seedSubjects(u, deck.id, [{ text: "x", cooldownAt: future }])

    const r = await callerFor(u).review.next({ mode: "normal" })
    expect(r.card).toBeNull()
    expect(r.dueCount).toBe(0)
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
    expect(recent.dueCount).toBe(10)

    const randomOutsideRecents = await pickNextCard({
      prisma,
      userId: u,
      includeOnCooldown: false,
      rng: () => 0.99,
    })
    expect(["s4", "s5", "s6", "s7", "s8", "s9"]).toContain(
      randomOutsideRecents.card?.subject.subject
    )
    expect(randomOutsideRecents.dueCount).toBe(10)
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
    expect(r.dueCount).toBe(0)
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
      { text: "Haus", cooldownAt: new Date(Date.now() - 1000), fixationLevel: "1" },
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
      { text: "Haus", cooldownAt: new Date(Date.now() - 1000), fixationLevel: "2" },
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
    expect(subjAfter.cooldownAt.getTime()).toBe(subjBefore.cooldownAt.getTime())
    expect(subjAfter.lastSeenAt).not.toBeNull()
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
    expect(subj.timesSeen).toBe(1)

    const reloaded = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    expect(reloaded.timesSeen).toBe(1)
    expect(reloaded.lastSeenAt).not.toBeNull()
  })
})
