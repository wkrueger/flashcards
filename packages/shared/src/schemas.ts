import { z } from "zod"
import { fixationLevelSchema } from "./fixation.js"

export const reviewModeSchema = z.enum(["normal", "free"])
export type ReviewMode = z.infer<typeof reviewModeSchema>

const id = z.string().min(1).max(64)
const cardTagSchema = z.string().trim().min(1).max(50).regex(/^\S+$/, "Tags cannot contain spaces")
const cardGenTemplateSchema = z.literal("createPhrasesForWords")

const languageId = z.number().int().positive()

export const createDeckInput = z.object({
  name: z.string().trim().min(1).max(100),
  defaultFrontLanguageId: languageId.nullish(),
  defaultBackLanguageId: languageId.nullish(),
})

export const updateDeckInput = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  defaultFrontLanguageId: languageId.nullish(),
  defaultBackLanguageId: languageId.nullish(),
})

export const idInput = z.object({ id })

export const subjectAutocompleteInput = z.object({
  query: z.string().trim().max(100),
})

export const renameSubjectInput = z.object({
  id,
  subject: z.string().trim().min(1).max(200),
})

export const createCardInput = z.object({
  deckId: id,
  subjectText: z.string().trim().min(1).max(200),
  front: z.string().min(1),
  back: z.string().min(1),
  genTemplate: cardGenTemplateSchema.nullish(),
  tags: z.array(cardTagSchema).max(20).default([]),
})

export const updateCardInput = z.object({
  id,
  subjectText: z.string().trim().min(1).max(200).optional(),
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  tags: z.array(cardTagSchema).max(20).optional(),
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
  excludeCardId: id.optional(),
})

export const reviewCompleteInput = z.object({
  cardId: id,
  chosenLevel: fixationLevelSchema,
})
