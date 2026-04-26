import { z } from "zod"
import { fixationLevelSchema } from "./fixation.js"

export const reviewModeSchema = z.enum(["normal", "free"])
export type ReviewMode = z.infer<typeof reviewModeSchema>

const id = z.string().min(1).max(64)

export const createDeckInput = z.object({
  name: z.string().trim().min(1).max(100),
})

export const renameDeckInput = z.object({
  id,
  name: z.string().trim().min(1).max(100),
})

export const idInput = z.object({ id })

export const subjectAutocompleteInput = z.object({
  query: z.string().trim().max(100),
})

export const createCardInput = z.object({
  deckId: id,
  subjectText: z.string().trim().min(1).max(200),
  front: z.string().min(1),
  back: z.string().min(1),
})

export const updateCardInput = z.object({
  id,
  subjectText: z.string().trim().min(1).max(200).optional(),
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
})

export const cardTemplateGeneratePreviewInput = z
  .object({
    template: z.literal("createPhrasesForWords"),
    frontLanguageId: z.number().int().positive(),
    backLanguageId: z.number().int().positive(),
    wordOrExpression: z.string().trim().min(1).max(200),
    count: z.number().int().min(1).max(5),
  })
  .refine((input) => input.frontLanguageId !== input.backLanguageId, {
    message: "Front and back languages must be different.",
    path: ["backLanguageId"],
  })

export const reviewNextInput = z.object({
  deckId: id.optional(),
  mode: reviewModeSchema,
})

export const reviewCompleteInput = z.object({
  cardId: id,
  chosenLevel: fixationLevelSchema,
})
