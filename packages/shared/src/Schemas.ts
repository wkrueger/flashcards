import { z } from "zod"
import { FIXATION_LEVELS } from "./Fixation.js"

export const fixationLevelSchema = z.enum(FIXATION_LEVELS)

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
  speechRecognitionEnabled: z.boolean().optional(),
  inverseReviewEnabled: z.boolean().optional(),
  sequentialEnabled: z.boolean().optional(),
})

export const updateDeckInput = z.object({
  id,
  name: z.string().trim().min(1).max(100).optional(),
  defaultFrontLanguageId: languageId.nullish(),
  defaultBackLanguageId: languageId.nullish(),
  speechRecognitionEnabled: z.boolean().optional(),
  inverseReviewEnabled: z.boolean().optional(),
  sequentialEnabled: z.boolean().optional(),
})

export const listDecksInput = z.object({
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  q: z.string().max(100).optional(),
})

export const moveDeckInput = z.object({
  id: z.string().min(1).max(64),
  afterId: z.string().min(1).max(64).nullable(),
})

export const idInput = z.object({ id })

export const confirmDeckImportInput = z
  .object({
    importId: z.string().min(1).max(64),
    mode: z.enum(["update", "create"]),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "create" && !data.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A deck name is required.",
        path: ["name"],
      })
    }
  })

export type DeckSpreadsheetInspectResult = {
  importId: string
  metaDeckId: string | null
  suggestedName: string
  existingDeck: { id: string; name: string } | null
}

export const subjectAutocompleteInput = z.object({
  deckId: id,
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
    wordOrExpression: z.string().trim().min(1).max(50),
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
  subjectId: id.optional(),
  cardId: id.optional(),
})

export const reviewCompleteInput = z
  .object({
    cardId: id,
    chosenLevel: fixationLevelSchema.optional(),
    inverse: z.boolean().optional(),
  })
  .refine((input) => input.inverse === true || input.chosenLevel !== undefined, {
    message: "chosenLevel is required when not in inverse mode.",
    path: ["chosenLevel"],
  })

export const sequentialMoveSchema = z.enum([
  "resume",
  "next",
  "prev",
  "first",
  "current",
  "subjectFirst",
])
export type SequentialMove = z.infer<typeof sequentialMoveSchema>

export const reviewSequentialInput = z.object({
  deckId: id,
  cardId: id.optional(),
  move: sequentialMoveSchema,
})

export const reviewAdvanceInput = z.object({ cardId: id })

export const reorderCardInput = z.object({
  cardId: id,
  direction: z.enum(["up", "down"]),
})

export const importProcessStatusSchema = z.enum([
  "UPLOADED",
  "ANALYZING",
  "AWAITING_CONFIGURATION",
  "VALIDATING",
  "IMPORTING",
  "SUCCEEDED",
  "FAILED",
])
export type ImportProcessStatus = z.infer<typeof importProcessStatusSchema>

export const ankiImportDeckConfigInput = z.object({
  name: z.string().trim().min(1).max(100),
  defaultFrontLanguageId: languageId.nullish(),
  defaultBackLanguageId: languageId.nullish(),
  inverseReviewEnabled: z.boolean().optional(),
})

export const ankiCardMappingSchema = z.object({
  frontField: z.string().trim().min(1),
  backField: z.string().trim().min(1),
})
export type AnkiCardMapping = z.infer<typeof ankiCardMappingSchema>

export const highlightWordsPluginSchema = z.object({
  type: z.literal("highlight_words"),
  frontWordsField: z.string().trim().min(1),
  backWordsField: z.string().trim().min(1),
})
export const importPluginSchema = highlightWordsPluginSchema
export type ImportPlugin = z.infer<typeof importPluginSchema>

export const ankiImportCardTypeMappingInput = z
  .object({
    modelKey: z.string().min(1),
    selected: z.boolean(),
    subjectField: z.string().trim().min(1).optional(),
    cardMappings: z.array(ankiCardMappingSchema).optional(),
    plugins: z.array(importPluginSchema).optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.selected) return
    if (!input.subjectField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subject field is required for selected card types.",
        path: ["subjectField"],
      })
    }
    if (!input.cardMappings || input.cardMappings.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one card mapping is required for selected card types.",
        path: ["cardMappings"],
      })
    }
  })

export const previewCardTypeMappingInput = z.object({
  processId: id,
  modelKey: z.string().min(1),
  subjectField: z.string().trim().min(1),
  cardMappings: z.array(ankiCardMappingSchema).min(1),
  plugins: z.array(importPluginSchema),
})
export type PreviewCardTypeMappingInput = z.infer<typeof previewCardTypeMappingInput>

export const saveAnkiImportConfigurationInput = z.object({
  id,
  deck: ankiImportDeckConfigInput,
  cardTypes: z.array(ankiImportCardTypeMappingInput).min(1),
})

export const ankiImportPreviewCardSchema = z.object({
  subjectText: z.string(),
  front: z.string(),
  back: z.string(),
})

export type AnkiImportPreviewCard = z.infer<typeof ankiImportPreviewCardSchema>

export type AnkiImportCardTypeView = {
  id: string
  modelKey: string
  modelName: string
  modelKind: "BASIC" | "CLOZE"
  rowCount: number
  fieldNames: string[]
  sampleRows: Record<string, string>[]
  selected: boolean
  subjectField: string | null
  cardMappings: AnkiCardMapping[]
  plugins: ImportPlugin[]
  previewCards: AnkiImportPreviewCard[]
}

export type AnkiImportListItemView = {
  id: string
  status: ImportProcessStatus
  filename: string
  deckName: string | null
  importedCardCount: number
  rowCount: number
  createdAt: string
}

export type AnkiImportProcessView = {
  id: string
  status: ImportProcessStatus
  filename: string
  fileSize: number
  detectedCollectionFile: string | null
  deckName: string | null
  defaultFrontLanguageId: number | null
  defaultBackLanguageId: number | null
  inverseReviewEnabled: boolean | null
  rowCount: number
  selectedRowCount: number
  importedCardCount: number
  failedRowCount: number
  errorSummary: string | null
  errorDetails: string[]
  createdDeckId: string | null
  cardTypes: AnkiImportCardTypeView[]
}

export type SpreadsheetImportStatusView = {
  jobId: string
  importId: string | null
  deckId: string | null
  status: "UPLOADED" | "IMPORTING" | "SUCCEEDED" | "FAILED"
  filename: string | null
  rowCount: number
  createdCardCount: number
  updatedCardCount: number
  deletedCardCount: number
  errorSummary: string | null
  errorDetails: string[]
}
