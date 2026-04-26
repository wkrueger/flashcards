import { TRPCError } from "@trpc/server"
import { cardTemplateGeneratePreviewInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { createOpenAIStructuredResponse } from "../../infra/openai.js"
import { cardTemplatePreviewOutput, promptLanguageName } from "./card-template.service.js"

export const cardTemplateRouter = router({
  generatePreviews: protectedProcedure
    .input(cardTemplateGeneratePreviewInput)
    .mutation(async ({ ctx, input }) => {
      const languages = await ctx.prisma.language.findMany({
        where: { id: { in: [input.frontLanguageId, input.backLanguageId] } },
      })
      const frontLanguage = languages.find((language) => language.id === input.frontLanguageId)
      const backLanguage = languages.find((language) => language.id === input.backLanguageId)

      if (!frontLanguage || !backLanguage) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Language not found." })
      }
      const frontPromptLanguage = promptLanguageName(frontLanguage.name)
      const backPromptLanguage = promptLanguageName(backLanguage.name)

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
        instructions:
          "Generate vocabulary flashcard previews. Return JSON only. Each card must have front and back markdown strings. Bold the requested word or expression and its translation with double asterisks. Keep phrases natural, short, and distinct. Each field must be a clean sentence in its language only — do not add the translation, the original word, synonyms, or any parenthetical or dash-separated gloss inside either field.",
        input: JSON.stringify({
          template: "Create phrases for words",
          wordOrExpression: input.wordOrExpression,
          count: input.count,
          frontLanguage: frontPromptLanguage,
          backLanguage: backPromptLanguage,
          task: `Write ${input.count} phrases in ${backPromptLanguage} using the requested word or expression, then translate each phrase to ${frontPromptLanguage}. The front field is the ${frontPromptLanguage} translation only — a natural sentence with no German words, no parentheses, and no dashes showing the original. The back field is the ${backPromptLanguage} phrase only — a natural sentence with no English words, no parentheses, and no dashes showing the translation.`,
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
