import { z } from "zod"
import { fixationLevelSchema } from "./fixation.js"

export const reviewModeSchema = z.enum(["normal", "free"])
export type ReviewMode = z.infer<typeof reviewModeSchema>

export const createDeckInput = z.object({
  name: z.string().trim().min(1).max(100),
})

export const renameDeckInput = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(100),
})

export const idInput = z.object({ id: z.string() })

export const subjectAutocompleteInput = z.object({
  query: z.string().trim().max(100),
})

export const createCardInput = z.object({
  deckId: z.string(),
  subjectText: z.string().trim().min(1).max(200),
  front: z.string().min(1),
  back: z.string().min(1),
})

export const updateCardInput = z.object({
  id: z.string(),
  subjectText: z.string().trim().min(1).max(200).optional(),
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
})

export const reviewNextInput = z.object({
  deckId: z.string().optional(),
  mode: reviewModeSchema,
})

export const reviewCompleteInput = z.object({
  cardId: z.string(),
  chosenLevel: fixationLevelSchema,
})
