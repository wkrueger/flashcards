import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

describe("decks domain", () => {
  beforeEach(async () => {
    await resetDomain()
  })

  it("each user's decks are isolated", async () => {
    const a = await makeUser("a")
    const b = await makeUser("b")
    await callerFor(a).decks.create({ name: "MyDeck" })
    await callerFor(b).decks.create({ name: "MyDeck" })

    const aDecks = await callerFor(a).decks.list()
    const bDecks = await callerFor(b).decks.list()
    expect(aDecks).toHaveLength(1)
    expect(bDecks).toHaveLength(1)
    expect(aDecks[0]!.id).not.toBe(bDecks[0]!.id)
  })

  it("rejects duplicate deck names per user", async () => {
    const a = await makeUser("a")
    await callerFor(a).decks.create({ name: "Same" })
    await expect(callerFor(a).decks.create({ name: "Same" })).rejects.toMatchObject({
      code: "CONFLICT",
    })
  })

  it("get returns deck metadata including card/word/cooldown counts", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })

    await trpc.cards.create({ deckId: deck.id, subjectText: "apple", front: "f1", back: "b1" })
    await trpc.cards.create({ deckId: deck.id, subjectText: "apple", front: "f2", back: "b2" })
    await trpc.cards.create({ deckId: deck.id, subjectText: "banana", front: "f3", back: "b3" })

    const subject = await prisma.subject.findFirst({ where: { subject: "apple" } })
    await prisma.subject.update({
      where: { id: subject!.id },
      data: { cooldownAt: new Date(Date.now() + DAY_MS) },
    })

    const result = await trpc.decks.get({ id: deck.id })
    expect(result.id).toBe(deck.id)
    expect(result.cardCount).toBe(3)
    expect(result.wordCount).toBe(2)
    expect(result.cooldownCount).toBe(1)
  })

  it("get returns the deck back-language speech recognition locale", async () => {
    const u = await makeUser("u")
    const other = await makeUser("other")
    const trpc = callerFor(u)
    const backLanguage = await prisma.language.upsert({
      where: { name: "Speech Test Deutsch" },
      update: {
        englishName: "German",
        emoji: "🇩🇪",
        speechRecognitionLocale: "de-DE",
      },
      create: {
        name: "Speech Test Deutsch",
        englishName: "German",
        emoji: "🇩🇪",
        speechRecognitionLocale: "de-DE",
      },
    })
    const deck = await trpc.decks.create({
      name: "d",
      defaultBackLanguageId: backLanguage.id,
    })

    const result = await trpc.decks.get({ id: deck.id })
    expect(result.speechRecognitionLocale).toBe("de-DE")
    await expect(callerFor(other).decks.get({ id: deck.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("get throws NOT_FOUND for another user's deck", async () => {
    const a = await makeUser("a")
    const b = await makeUser("b")
    const deck = await callerFor(a).decks.create({ name: "secret" })
    await expect(callerFor(b).decks.get({ id: deck.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("upcomingDueCounts counts subjects whose cooldown elapses within each window", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    const now = Date.now()
    const inHours = (h: number) => new Date(now + h * HOUR_MS)

    const cooldowns: Record<string, Date> = {
      due: new Date(now - HOUR_MS),
      "in-12h": inHours(12),
      "in-30h": inHours(30),
      "in-3d": new Date(now + 3 * DAY_MS),
      "in-10d": new Date(now + 10 * DAY_MS),
    }

    for (const [text, cooldownAt] of Object.entries(cooldowns)) {
      const card = await trpc.cards.create({
        deckId: deck.id,
        subjectText: text,
        front: `f-${text}`,
        back: `b-${text}`,
      })
      await prisma.subject.update({
        where: { id: card.subjectId },
        data: { cooldownAt },
      })
    }

    const stats = await trpc.decks.upcomingDueCounts({ id: deck.id })
    expect(stats.in24h).toBe(2)
    expect(stats.in2d).toBe(3)
    expect(stats.in1w).toBe(4)
  })

  it("randomSubjects returns up to 8 subjects from the deck", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    for (let i = 0; i < 12; i++) {
      await trpc.cards.create({
        deckId: deck.id,
        subjectText: `subject-${i}`,
        front: `f-${i}`,
        back: `b-${i}`,
      })
    }
    const sample = await trpc.decks.randomSubjects({ id: deck.id })
    expect(sample).toHaveLength(8)
    const unique = new Set(sample.map((s) => s.id))
    expect(unique.size).toBe(8)
    expect(sample[0]!.subject).toMatch(/^subject-/)
  })

  it("randomSubjects only returns subjects from the requested deck", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const a = await trpc.decks.create({ name: "a" })
    const b = await trpc.decks.create({ name: "b" })
    await trpc.cards.create({ deckId: a.id, subjectText: "x", front: "f", back: "b" })
    await trpc.cards.create({ deckId: b.id, subjectText: "y", front: "f", back: "b" })

    const aSample = await trpc.decks.randomSubjects({ id: a.id })
    expect(aSample.map((s) => s.subject)).toEqual(["x"])
  })

  it("reviewStats returns 7 sequential days, filling missing days with zero", async () => {
    const u = await makeUser("u")
    const trpc = callerFor(u)
    const deck = await trpc.decks.create({ name: "d" })
    const today = new Date()
    const utcDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )
    const threeDaysAgo = new Date(utcDay.getTime() - 3 * DAY_MS)
    await prisma.reviewStat.create({
      data: { deckId: deck.id, date: utcDay, cardMinutes: 100, cardCount: 4 },
    })
    await prisma.reviewStat.create({
      data: { deckId: deck.id, date: threeDaysAgo, cardMinutes: 50, cardCount: 2 },
    })

    const stats = await trpc.decks.reviewStats({ id: deck.id })
    expect(stats).toHaveLength(7)
    expect(stats[stats.length - 1]!.date.getTime()).toBe(utcDay.getTime())
    expect(stats[stats.length - 1]!.cardMinutes).toBe(100)
    expect(stats[stats.length - 1]!.cardCount).toBe(4)
    expect(stats[stats.length - 4]!.date.getTime()).toBe(threeDaysAgo.getTime())
    expect(stats[stats.length - 4]!.cardMinutes).toBe(50)
    expect(stats[stats.length - 4]!.cardCount).toBe(2)
    expect(stats[0]!.cardMinutes).toBe(0)
    expect(stats[0]!.cardCount).toBe(0)
  })
})
