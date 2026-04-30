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
    let requestBody: {
      model: string
      text: { format: { type: string; name: string } }
      input: unknown
    }
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      requestBody = body
      const outputText = JSON.stringify({
        cards: [
          {
            front: "The **house** is old.",
            back: "Das **Haus** ist alt.",
            variant: "bigger",
          },
          {
            front: "I see the **house**.",
            back: "Ich sehe das **Haus**.",
            variant: "meaning",
          },
        ],
      })

      return new Response(
        JSON.stringify({
          id: "resp_test_123",
          object: "response",
          output: [
            {
              id: "msg_test_123",
              type: "message",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: outputText, annotations: [] }],
            },
          ],
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
    expect(requestBody!.model).toBe("test-model")
    expect(requestBody!.text.format.type).toBe("json_schema")
    expect(requestBody!.text.format.name).toBe("card_template_previews")
    const requestInput = JSON.stringify(requestBody!.input)
    expect(requestInput).toContain("Haus")
    expect(requestInput).toContain("backLanguage")
    expect(requestInput).toContain("German")
    expect(requestInput).toContain("small statements in German")
    expect(requestInput).toContain("variant field")
    expect(requestInput).toContain("bigger")
    expect(requestInput).toContain("meaning")
    expect(requestInput).not.toContain("Deutsch")
    expect(previews.cards).toEqual([
      {
        front: "The **house** is old.",
        back: "Das **Haus** ist alt.",
        tags: ["gen:bigger"],
      },
      {
        front: "I see the **house**.",
        back: "Ich sehe das **Haus**.",
        tags: ["gen:meaning"],
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
