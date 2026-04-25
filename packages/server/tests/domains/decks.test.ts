import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"

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
})
