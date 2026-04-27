import { TRPCError } from "@trpc/server"
import { cardTemplateGeneratePreviewInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { createOpenAIStructuredResponse } from "../../infra/openai.js"
import { rateLimit } from "../../infra/rate-limit.js"
import { cardTemplatePreviewOutput } from "./card-template.service.js"

const germanExtraPrompt =
  "\n\n## Specifically for German: \nIf the input word is a verb, the output phrase " +
  "may use any tense of the same verb, ensure we have one German phrase in the past perfect and one in the simple present. " +
  "When the German phrase is in past perfect, also bold the auxiliary verb. " +
  "Avoid repeating tenses between German phrases. " +
  "When the verb is reflexive, also bold the reflexive pronoun. " +
  "Avoid repeating the grammatical person between German phrases and also include phrases with the 2nd grammatical person. " +
  "If the input verb is a separated verb (a verb with a prefix), you can build phrases " +
  "with the verb either split or joined. When splitting the verb, also bold the prefix. When an English translation is a phrasal verb, bold both parts of the verb. " +
  "If the input verb does not include a prefix, only build phrases with the same verb without a prefix. " +
  "For any type of word (nouns, adjectives, adverbs, etc), you may use any declination and mode of that word."

const expressionPrompt =
  "\n\nIf the input text contains multiple words, don't attain yourself on keeping " +
  "the same order of words, as long as the meaning of the input is preserved. If the input text" +
  " contains '...'` + ` (three dots) or 'something', consider " +
  "that the input may surround other words of the generated phrase."

export const cardTemplateRouter = router({
  generatePreviews: protectedProcedure
    .input(cardTemplateGeneratePreviewInput)
    .mutation(async ({ ctx, input }) => {
      rateLimit(`cardTemplate.generatePreviews:${ctx.user.id}`, {
        windowMs: 60_000,
        max: 3,
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

      let instructions =
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
        instructions += germanExtraPrompt
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
        instructions,
        input: JSON.stringify({
          template: "Create phrases for words",
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
