import { rm } from "node:fs/promises"

import type { MultipartFile } from "@fastify/multipart"
import type {
  AnkiCardMapping,
  AnkiImportCardTypeView,
  AnkiImportPreviewCard,
  AnkiImportProcessView,
  ImportPlugin,
  ImportProcessStatus,
} from "@cards/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"

export const FIELD_SEPARATOR = "\u001f"
const TERMINAL_IMPORT_PROCESS_STATUSES: ImportProcessStatus[] = ["SUCCEEDED", "FAILED"]

export const INCOMPLETE_IMPORT_PROCESS_STATUSES = [
  "UPLOADED",
  "ANALYZING",
  "AWAITING_CONFIGURATION",
  "VALIDATING",
  "IMPORTING",
] as const satisfies ImportProcessStatus[]

export type DbClient = PrismaClient | Prisma.TransactionClient

export type ImportProcessWithCardTypes = Prisma.ImportProcessGetPayload<{
  include: { cardTypes: true }
}>

export type StoredCardType = ImportProcessWithCardTypes["cardTypes"][number]

export type AnkiModelDefinition = {
  key: string
  name: string
  kind: "BASIC" | "CLOZE"
  fieldNames: string[]
}

export type AnkiArchiveRow = {
  noteId: number
  values: Record<string, string>
}

export type AnkiArchiveData = {
  collectionFile: string
  models: Map<string, AnkiModelDefinition>
  rowsByModelKey: Map<string, AnkiArchiveRow[]>
}

export type MappedImportRow = {
  subjectText: string
  subjectKey: string
  front: string
  frontHash: string
  back: string
}

export type UploadWriteResult = {
  fileSize: number
  storagePath: string
}

export type SaveConfigurationInput = {
  processId: string
  userId: string
  deck: {
    name: string
    defaultFrontLanguageId?: number | null
    defaultBackLanguageId?: number | null
    inverseReviewEnabled?: boolean
  }
  cardTypes: Array<{
    modelKey: string
    selected: boolean
    subjectField?: string
    cardMappings?: AnkiCardMapping[]
    plugins?: ImportPlugin[]
  }>
}

export type UploadLimitResult = {
  allowed: boolean
  message?: string
}

export type HttpError = Error & {
  statusCode: number
}

export type HandleAnkiImportUploadInput = {
  rawHeaders: Record<string, string | string[] | undefined>
  getFile: () => Promise<MultipartFile | undefined>
}

export function createHttpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode })
}

export function getErrorStatusCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode
  }

  return null
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

export function stripMediaAndMarkup(value: string) {
  return decodeHtmlEntities(
    value
      .replaceAll(/\[sound:[^\]]+\]/g, " ")
      .replaceAll(/<img\b[^>]*>/gi, " ")
      .replaceAll(/<audio\b[^>]*>.*?<\/audio>/gis, " ")
      .replaceAll(/<video\b[^>]*>.*?<\/video>/gis, " ")
      .replaceAll(/<source\b[^>]*>/gi, " ")
      .replaceAll(/<br\s*\/?>/gi, "\n")
      .replaceAll(/<\/div>/gi, "\n")
      .replaceAll(/<\/p>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
  )
    .replaceAll(/\r\n/g, "\n")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .trim()
}

export async function deleteFileIfExists(storagePath: string | null | undefined) {
  if (!storagePath) return
  await rm(storagePath, { force: true })
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return []
  return JSON.parse(value) as T[]
}

function serializeCardType(cardType: StoredCardType): AnkiImportCardTypeView {
  return {
    id: cardType.id,
    modelKey: cardType.modelKey,
    modelName: cardType.modelName,
    modelKind: cardType.modelKind,
    rowCount: cardType.rowCount,
    fieldNames: parseJsonArray<string>(cardType.fieldNamesJson),
    sampleRows: parseJsonArray<Record<string, string>>(cardType.sampleRowsJson),
    selected: cardType.selected,
    subjectField: cardType.subjectField ?? null,
    cardMappings: parseJsonArray<AnkiCardMapping>(cardType.cardMappingsJson),
    plugins: parseJsonArray<ImportPlugin>(cardType.pluginsJson),
    previewCards: parseJsonArray<AnkiImportPreviewCard>(cardType.previewCardsJson),
  }
}

export function serializeImportProcess(process: ImportProcessWithCardTypes): AnkiImportProcessView {
  return {
    id: process.id,
    status: process.status,
    filename: process.filename,
    fileSize: process.fileSize,
    detectedCollectionFile: process.detectedCollectionFile ?? null,
    deckName: process.deckName ?? null,
    defaultFrontLanguageId: process.defaultFrontLanguageId ?? null,
    defaultBackLanguageId: process.defaultBackLanguageId ?? null,
    inverseReviewEnabled: process.inverseReviewEnabled ?? null,
    rowCount: process.rowCount,
    selectedRowCount: process.selectedRowCount,
    importedCardCount: process.importedCardCount,
    failedRowCount: process.failedRowCount,
    errorSummary: process.errorSummary ?? null,
    errorDetails: parseJsonArray<string>(process.errorDetailsJson),
    createdDeckId: process.createdDeckId ?? null,
    cardTypes: process.cardTypes
      .slice()
      .sort(
        (left, right) =>
          right.rowCount - left.rowCount || left.modelName.localeCompare(right.modelName)
      )
      .map(serializeCardType),
  }
}
