import { TRPCError } from "@trpc/server"
import { cardTemplateGeneratePreviewInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { createOpenAIStructuredResponse } from "../../infra/openai.js"
import { rateLimit } from "../../infra/rate-limit.js"
import { cardTemplatePreviewOutput } from "./card-template.service.js"
import fs from "node:fs"

const _germanExtraPrompt =
  "\n\n" + fs.readFileSync(new URL("./german-extra-prompt.md", import.meta.url), "utf-8")

function getGermanPrompt() {
  const reroll = Math.random() > 0.2
  if (!reroll) {
    return _germanExtraPrompt
  } else {
    return _germanExtraPrompt.replace(
      "%%REROLL_SIMPLE_PAST%%",
      "- Ih the generated phrase is in the simple past, rewrite it in the past perfect."
    )
  }
}

const expressionPrompt =
  "\n\nIf the input text contains multiple words, don't attain yourself on keeping " +
  "the same order of words, as long as the meaning of the input is preserved. If the input text" +
  " contains '...'` + ` (three dots) or 'something', consider " +
  "that the input may surround other words of the generated phrase."

export const cardTemplateRouter = router({
  generatePreviews: protectedProcedure
    .input(cardTemplateGeneratePreviewInput)
    .mutation(async ({ ctx, input }) => {
      // fixme: local memory
      rateLimit(`cardTemplate.generatePreviews:${ctx.user.id}`, {
        windowMs: 60_000 * 2,
        max: 6,
      })
      const languages = await ctx.prisma.language.findMany({
        where: { id: { in: [input.frontLanguageId, input.backLanguageId] } },
      })
      const frontLanguage = languages.find((language) => language.id === input.frontLanguageId)
      const backLanguage = languages.find((language) => language.id === input.backLanguageId)

      if (!frontLanguage || !backLanguage) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Language not found." })
      }
      const frontPromptLanguage = frontLanguage.englishName ?? frontLanguage.name
      const backPromptLanguage = backLanguage.englishName ?? backLanguage.name

      let systemPrompt =
        "Generate vocabulary flashcard previews. Return JSON only. " +
        "Each card must have front and back markdown strings. Bold the requested word or " +
        "expression and its translation with double asterisks. Keep phrases natural, complete, and distinct."

      let task =
        `Write ${input.count} phrases in ${backPromptLanguage} using the requested word` +
        ` or expression, then translate each phrase to ${frontPromptLanguage}. The front field ` +
        `is the ${frontPromptLanguage} translation.  The back field is the ${backPromptLanguage} phrase. ` +
        `All phrases must be natural and complete sentences without annotations.\n\n`
      expressionPrompt

      if (backPromptLanguage === "German") {
        systemPrompt += getGermanPrompt()
      }

      const output = await createOpenAIStructuredResponse({
        schemaName: "card_template_previews",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["cards"],
          properties: {
            cards: {
              type: "array",
              minItems: input.count,
              maxItems: input.count,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["front", "back"],
                properties: {
                  front: { type: "string" },
                  back: { type: "string" },
                },
              },
            },
          },
        },
        systemPrompt: systemPrompt,
        input: JSON.stringify({
          template: "Create phrases for the input words or expressions",
          wordOrExpression: input.wordOrExpression,
          count: input.count,
          frontLanguage: frontPromptLanguage,
          backLanguage: backPromptLanguage,
          task,
        }),
      })

      const parsed = cardTemplatePreviewOutput.parse(output)
      if (parsed.cards.length !== input.count) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "OpenAI returned the wrong number of card previews.",
        })
      }

      return {
        template: input.template,
        subjectText: input.wordOrExpression,
        frontLanguage,
        backLanguage,
        cards: parsed.cards,
      }
    }),
})
