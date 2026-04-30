import { beforeEach, describe, expect, it } from "vitest"
import { TRPCError } from "@trpc/server"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"

describe("cards domain", () => {
  beforeEach(async () => {
    await resetDomain()
  })

  it("creates subject transparently and enforces unique (subject, frontHash)", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })

    const card = await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "**Haus** ist groß.",
      back: "The **house** is big.",
    })
    expect(card.frontHash).toHaveLength(64)

    await trpc.cards.create({
      deckId: deck.id,
      subjectText: "Haus",
      front: "Mein **Haus** ist neu.",
      back: "My **house** is new.",
    })

    const subjects = await prisma.subject.findMany({ where: { userId } })
    expect(subjects).toHaveLength(1)
    expect(subjects[0]!.subject).toBe("Haus")

    await expect(
      trpc.cards.create({
        deckId: deck.id,
        subjectText: "Haus",
        front: "**Haus** ist groß.",
        back: "duplicate",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("trims subjects and treats different casing as the same subject", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })

    await trpc.cards.create({
      deckId: deck.id,
      subjectText: "  Haus  ",
      front: "front 1",
      back: "back 1",
    })

    await trpc.cards.create({
      deckId: deck.id,
      subjectText: "haus",
      front: "front 2",
      back: "back 2",
    })

    const subjects = await prisma.subject.findMany({ where: { userId } })
    expect(subjects).toHaveLength(1)
    expect(subjects[0]!.subject).toBe("Haus")
    expect(subjects[0]!.subjectKey).toBe("haus")

    await expect(
      trpc.cards.create({
        deckId: deck.id,
        subjectText: "HAUS",
        front: "front 1",
        back: "duplicate",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("scopes deck access per user", async () => {
    const a = await makeUser("a")
    const b = await makeUser("b")
    const deckA = await callerFor(a).decks.create({ name: "ADeck" })

    await expect(callerFor(b).decks.get({ id: deckA.id })).rejects.toBeInstanceOf(TRPCError)

    await expect(
      callerFor(b).cards.create({
        deckId: deckA.id,
        subjectText: "x",
        front: "f",
        back: "b",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
