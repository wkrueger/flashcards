import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"

const originalApiKey = process.env.OPENAI_API_KEY
const originalModel = process.env.OPENAI_MODEL

async function seedLanguages() {
  const english = await prisma.language.upsert({
    where: { name: "English" },
    update: { emoji: "🇬🇧", englishName: "English" },
    create: { name: "English", emoji: "🇬🇧", englishName: "English" },
  })
  const deutsch = await prisma.language.upsert({
    where: { name: "Deutsch" },
    update: { emoji: "🇩🇪", englishName: "German" },
    create: { name: "Deutsch", emoji: "🇩🇪", englishName: "German" },
  })
  return { english, deutsch }
}

describe("card template domain", () => {
  beforeEach(async () => {
    await resetDomain()
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_MODEL = "test-model"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalApiKey
    if (originalModel === undefined) delete process.env.OPENAI_MODEL
    else process.env.OPENAI_MODEL = originalModel
  })

  it("generates phrase previews with OpenAI structured output", async () => {
    const { english, deutsch } = await seedLanguages()
    const userId = await makeUser("alice")
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("test-model")
      expect(body.text.format.type).toBe("json_schema")
      expect(body.text.format.name).toBe("card_template_previews")
      expect(body.input[1].content).toContain("Haus")
      expect(body.input[1].content).toContain('"backLanguage":"German"')
      expect(body.input[1].content).toContain("phrases in German")
      expect(body.input[1].content).not.toContain('"backLanguage":"Deutsch"')

      return new Response(
        JSON.stringify({
          id: "resp_test_123",
          object: "response",
          output_text: JSON.stringify({
            cards: [
              {
                front: "The **house** is old.",
                back: "Das **Haus** ist alt.",
              },
              {
                front: "I see the **house**.",
                back: "Ich sehe das **Haus**.",
              },
            ],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetch)

    const previews = await callerFor(userId).cardTemplate.generatePreviews({
      template: "createPhrasesForWords",
      frontLanguageId: english.id,
      backLanguageId: deutsch.id,
      wordOrExpression: "Haus",
      count: 2,
    })

    expect(previews.subjectText).toBe("Haus")
    expect(previews.frontLanguage.name).toBe("English")
    expect(previews.backLanguage.name).toBe("Deutsch")
    expect(previews.cards).toEqual([
      {
        front: "The **house** is old.",
        back: "Das **Haus** ist alt.",
      },
      {
        front: "I see the **house**.",
        back: "Ich sehe das **Haus**.",
      },
    ])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("rejects matching front and back languages", async () => {
    const { english } = await seedLanguages()
    const userId = await makeUser("alice")

    await expect(
      callerFor(userId).cardTemplate.generatePreviews({
        template: "createPhrasesForWords",
        frontLanguageId: english.id,
        backLanguageId: english.id,
        wordOrExpression: "house",
        count: 1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("requires an OpenAI API key", async () => {
    const { english, deutsch } = await seedLanguages()
    const userId = await makeUser("alice")
    delete process.env.OPENAI_API_KEY

    await expect(
      callerFor(userId).cardTemplate.generatePreviews({
        template: "createPhrasesForWords",
        frontLanguageId: english.id,
        backLanguageId: deutsch.id,
        wordOrExpression: "house",
        count: 1,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })
})
