import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { tmpdir } from "node:os"

import type { MultipartFile } from "@fastify/multipart"
import { TRPCError } from "@trpc/server"
import AdmZip from "adm-zip"
import Database from "better-sqlite3"
import type {
  AnkiCardMapping,
  AnkiImportCardTypeView,
  AnkiImportListItemView,
  AnkiImportPreviewCard,
  AnkiImportProcessView,
  ImportPlugin,
  ImportProcessStatus,
} from "@cards/shared"
import { getSessionFromRawHeaders } from "../../infra/auth.js"
import { hashFront } from "../cards/cards.service.js"
import { randomSubjectKey, subjectKeyFor } from "../subjects/subjects.service.js"
import {
  ImportCardTypeKind,
  ImportProcessStatus as PrismaImportProcessStatus,
  WorkerJobType,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js"

const FIELD_SEPARATOR = "\u001f"
const TERMINAL_IMPORT_PROCESS_STATUSES: ImportProcessStatus[] = ["SUCCEEDED", "FAILED"]
const INCOMPLETE_IMPORT_PROCESS_STATUSES = Object.values(PrismaImportProcessStatus).filter(
  (status) => !TERMINAL_IMPORT_PROCESS_STATUSES.includes(status)
)
const ALLOWED_APKG_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
])

export const ANKI_IMPORT_UPLOAD_MAX_BYTES = 300 * 1024 * 1024
const FREE_USER_UPLOAD_WINDOW_MS = 10 * 60 * 1000
const FREE_USER_UPLOAD_MAX_PER_USER = 1
const FREE_USER_UPLOAD_MAX_GLOBAL = 5
const STALE_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const COMPLETED_IMPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

type DbClient = PrismaClient | Prisma.TransactionClient

type ImportProcessWithCardTypes = Prisma.ImportProcessGetPayload<{
  include: { cardTypes: true }
}>

type StoredCardType = ImportProcessWithCardTypes["cardTypes"][number]

type AnkiModelDefinition = {
  key: string
  name: string
  kind: "BASIC" | "CLOZE"
  fieldNames: string[]
}

type AnkiArchiveRow = {
  noteId: number
  values: Record<string, string>
}

type AnkiArchiveData = {
  collectionFile: string
  models: Map<string, AnkiModelDefinition>
  rowsByModelKey: Map<string, AnkiArchiveRow[]>
}

type MappedImportRow = {
  subjectText: string
  subjectKey: string
  front: string
  frontHash: string
  back: string
}

type UploadWriteResult = {
  fileSize: number
  storagePath: string
}

type SaveConfigurationInput = {
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

type UploadLimitResult = {
  allowed: boolean
  message?: string
}

type HttpError = Error & {
  statusCode: number
}

type HandleAnkiImportUploadInput = {
  rawHeaders: Record<string, string | string[] | undefined>
  getFile: () => Promise<MultipartFile | undefined>
}

function createHttpError(statusCode: number, message: string): HttpError {
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

function importStorageDir() {
  return resolve(process.cwd(), ".uploads/anki-imports")
}

function importStoragePath() {
  return join(importStorageDir(), `${Date.now()}-${randomUUID()}.apkg`)
}

export async function deleteFileIfExists(storagePath: string | null | undefined) {
  if (!storagePath) return
  await rm(storagePath, { force: true })
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return []
  return JSON.parse(value) as T[]
}

function parseJsonObject<T>(value: string | null | undefined): T {
  if (!value) {
    throw new Error("Missing JSON object value.")
  }
  return JSON.parse(value) as T
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

function isApkgFilename(filename: string) {
  return extname(filename).toLowerCase() === ".apkg"
}

export function isSupportedApkgUpload(filename: string, mimetype: string | undefined) {
  const normalizedMime = (mimetype ?? "").toLowerCase()
  return (
    isApkgFilename(filename) && (!normalizedMime || ALLOWED_APKG_MIME_TYPES.has(normalizedMime))
  )
}

export async function ensureImportStorageDir() {
  await mkdir(importStorageDir(), { recursive: true })
}

export async function cleanupStaleImportProcesses(prisma: PrismaClient) {
  const staleCutoff = new Date(Date.now() - STALE_IMPORT_MAX_AGE_MS)
  const completedCutoff = new Date(Date.now() - COMPLETED_IMPORT_MAX_AGE_MS)

  const toDelete = await prisma.importProcess.findMany({
    where: {
      OR: [
        { status: { in: INCOMPLETE_IMPORT_PROCESS_STATUSES }, createdAt: { lt: staleCutoff } },
        {
          status: { in: ["SUCCEEDED", "FAILED"] },
          completedAt: { lt: completedCutoff },
        },
      ],
    },
    select: { id: true, storagePath: true },
  })

  if (toDelete.length === 0) {
    return 0
  }

  await Promise.all(toDelete.map((item) => deleteFileIfExists(item.storagePath)))
  await prisma.importProcess.deleteMany({
    where: { id: { in: toDelete.map((item) => item.id) } },
  })

  return toDelete.length
}

export async function getUploadLimitResult(
  prisma: PrismaClient,
  userId: string
): Promise<UploadLimitResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })

  if (user?.plan !== "free") {
    return { allowed: true }
  }

  const cutoff = new Date(Date.now() - FREE_USER_UPLOAD_WINDOW_MS)
  const [userCount, globalCount] = await Promise.all([
    prisma.importProcess.count({
      where: {
        userId,
        createdAt: { gte: cutoff },
      },
    }),
    prisma.importProcess.count({
      where: {
        createdAt: { gte: cutoff },
        user: { is: { plan: "free" } },
      },
    }),
  ])

  if (userCount >= FREE_USER_UPLOAD_MAX_PER_USER) {
    return {
      allowed: false,
      message: "Free users can upload at most 1 Anki file every 10 minutes.",
    }
  }

  if (globalCount >= FREE_USER_UPLOAD_MAX_GLOBAL) {
    return {
      allowed: false,
      message: "Free-user Anki uploads are temporarily saturated. Try again in a few minutes.",
    }
  }

  return { allowed: true }
}

export async function writeUploadStreamToStorage(
  fileStream: NodeJS.ReadableStream,
  storagePath = importStoragePath()
): Promise<UploadWriteResult> {
  await ensureImportStorageDir()

  let fileSize = 0

  const countBytes = new Transform({
    transform(chunk, _encoding, callback) {
      fileSize += chunk.length
      callback(null, chunk)
    },
  })

  await pipeline(fileStream, countBytes, createWriteStream(storagePath))

  return {
    fileSize,
    storagePath,
  }
}

export async function createImportProcessForUpload(
  prisma: PrismaClient,
  input: {
    userId: string
    filename: string
    fileSize: number
    storagePath: string
  }
) {
  return prisma.$transaction(async (tx) => {
    const process = await tx.importProcess.create({
      data: {
        userId: input.userId,
        filename: basename(input.filename),
        fileSize: input.fileSize,
        storagePath: input.storagePath,
        status: PrismaImportProcessStatus.UPLOADED,
      },
    })

    await tx.workerJob.create({
      data: {
        processId: process.id,
        type: WorkerJobType.ANALYZE_ANKI_IMPORT,
      },
    })

    return tx.importProcess.update({
      where: { id: process.id },
      data: { status: PrismaImportProcessStatus.ANALYZING },
      include: { cardTypes: true },
    })
  })
}

export async function handleAnkiImportUpload(
  prisma: PrismaClient,
  input: HandleAnkiImportUploadInput
) {
  const session = await getSessionFromRawHeaders(input.rawHeaders)

  if (!session?.user) {
    throw createHttpError(401, "Unauthorized.")
  }

  await cleanupStaleImportProcesses(prisma)

  const uploadLimit = await getUploadLimitResult(prisma, session.user.id)
  if (!uploadLimit.allowed) {
    throw createHttpError(429, uploadLimit.message ?? "Upload limit reached.")
  }

  let storagePath: string | null = null

  try {
    const part = await input.getFile()

    if (!part) {
      throw createHttpError(400, "No file was uploaded.")
    }

    if (!part.filename || !isSupportedApkgUpload(part.filename, part.mimetype)) {
      part.file.resume()
      throw createHttpError(400, "Only .apkg Anki package uploads are supported.")
    }

    const upload = await writeUploadStreamToStorage(part.file)
    storagePath = upload.storagePath

    if (part.file.truncated || upload.fileSize > ANKI_IMPORT_UPLOAD_MAX_BYTES) {
      throw createHttpError(413, "The uploaded file exceeds the 300MB limit.")
    }

    const process = await createImportProcessForUpload(prisma, {
      userId: session.user.id,
      filename: part.filename,
      fileSize: upload.fileSize,
      storagePath,
    })

    return { processId: process.id }
  } catch (error) {
    await deleteFileIfExists(storagePath)

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_REQ_FILE_TOO_LARGE"
    ) {
      throw createHttpError(413, "The uploaded file exceeds the 300MB limit.")
    }

    throw error
  }
}

async function extractCollectionDatabase(archivePath: string, tempDirectory: string) {
  const archive = new AdmZip(archivePath)
  const collectionEntry =
    archive.getEntry("collection.anki21") ?? archive.getEntry("collection.anki2")

  if (!collectionEntry) {
    throw new Error("The .apkg file does not contain collection.anki21 or collection.anki2.")
  }

  const databasePath = join(tempDirectory, basename(collectionEntry.entryName))
  await writeFile(databasePath, collectionEntry.getData())

  return {
    collectionFile: collectionEntry.entryName,
    databasePath,
  }
}

function getFieldNamesByModel(
  models: Record<
    string,
    { id: number; name: string; type: number; flds: Array<{ name: string; ord: number }> }
  >
) {
  return new Map(
    Object.values(models).map((model) => [
      String(model.id),
      {
        key: String(model.id),
        name: model.name,
        kind: model.type === 1 ? "CLOZE" : "BASIC",
        fieldNames: [...model.flds]
          .sort((left, right) => left.ord - right.ord)
          .map((field) => field.name),
      } satisfies AnkiModelDefinition,
    ])
  )
}

function parseNoteFields(rawFields: string, fieldNames: string[]) {
  const values = rawFields.split(FIELD_SEPARATOR)
  return Object.fromEntries(fieldNames.map((name, index) => [name, values[index] ?? ""]))
}

export async function readAnkiArchiveData(archivePath: string): Promise<AnkiArchiveData> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "anki-import-"))
  let database: Database.Database | null = null

  try {
    const { collectionFile, databasePath } = await extractCollectionDatabase(
      archivePath,
      tempDirectory
    )
    database = new Database(databasePath, { readonly: true })

    const modelsRow = database.prepare("select models from col limit 1").get() as
      | { models: string }
      | undefined

    if (!modelsRow) {
      throw new Error("Could not read note models from the Anki collection.")
    }

    const models = getFieldNamesByModel(
      JSON.parse(modelsRow.models) as Record<
        string,
        { id: number; name: string; type: number; flds: Array<{ name: string; ord: number }> }
      >
    )

    const rowsByModelKey = new Map<string, AnkiArchiveRow[]>(
      [...models.keys()].map((modelKey) => [modelKey, []])
    )

    const notes = database.prepare("select id, mid, flds from notes order by id").all() as Array<{
      id: number
      mid: number
      flds: string
    }>

    for (const note of notes) {
      const model = models.get(String(note.mid))
      if (!model) continue

      const rows = rowsByModelKey.get(model.key)
      if (!rows) continue

      rows.push({
        noteId: note.id,
        values: parseNoteFields(note.flds, model.fieldNames),
      })
    }

    return {
      collectionFile,
      models,
      rowsByModelKey,
    }
  } finally {
    database?.close()
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

function mapPreviewCard(
  sampleRow: Record<string, string>,
  mapping: {
    subjectField: string
    frontField: string
    backField: string
  }
): AnkiImportPreviewCard {
  return {
    subjectText: stripMediaAndMarkup(sampleRow[mapping.subjectField] ?? ""),
    front: stripMediaAndMarkup(sampleRow[mapping.frontField] ?? ""),
    back: stripMediaAndMarkup(sampleRow[mapping.backField] ?? ""),
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

type HighlightRange = {
  start: number
  end: number
}

function findSequentialWordRanges(content: string, words: string[]): HighlightRange[] | null {
  const ranges: HighlightRange[] = []
  let searchStart = 0

  for (const word of words) {
    const regex = new RegExp(escapeRegex(word), "i")
    const slice = content.slice(searchStart)
    const match = regex.exec(slice)
    if (!match || match.index === undefined) {
      return null
    }

    const start = searchStart + match.index
    const end = start + match[0].length
    ranges.push({ start, end })
    searchStart = end
  }

  return ranges
}

function applyHighlightRanges(content: string, ranges: HighlightRange[]) {
  let result = content

  for (const range of [...ranges].reverse()) {
    result = `${result.slice(0, range.start)}**${result.slice(range.start, range.end)}**${result.slice(range.end)}`
  }

  return result
}

function applyHighlightWords(
  content: string,
  wordsField: string,
  rowValues: Record<string, string>
): string {
  const raw = (rowValues[wordsField] ?? "").trim()
  if (!raw) return content

  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  for (const item of items) {
    const words = item.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue

    const ranges = findSequentialWordRanges(content, words)
    if (ranges) {
      return applyHighlightRanges(content, ranges)
    }
  }

  return `(${raw})  \n${content}`
}

function applyPlugins(
  content: string,
  side: "front" | "back",
  plugins: ImportPlugin[],
  rowValues: Record<string, string>
): string {
  let result = content
  for (const plugin of plugins) {
    if (plugin.type === "highlight_words") {
      const field = side === "front" ? plugin.frontWordsField : plugin.backWordsField
      result = applyHighlightWords(result, field, rowValues)
    }
  }
  return result
}

async function assertLanguagesExist(prisma: DbClient, ids: number[]) {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return

  const found = await prisma.language.count({
    where: { id: { in: uniqueIds } },
  })

  if (found !== uniqueIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Language not found.",
    })
  }
}

async function findOwnedImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await prisma.importProcess.findFirst({
    where: { id: processId, userId },
    include: { cardTypes: true },
  })

  if (!process) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Import process not found." })
  }

  return process
}

export async function deleteImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await findOwnedImportProcess(prisma, userId, processId)
  await deleteFileIfExists(process.storagePath)
  await prisma.importProcess.delete({ where: { id: process.id } })
}

export async function getImportProcessView(
  prisma: PrismaClient,
  userId: string,
  processId: string
) {
  const process = await findOwnedImportProcess(prisma, userId, processId)
  return serializeImportProcess(process)
}

export async function listImportProcesses(
  prisma: PrismaClient,
  userId: string
): Promise<AnkiImportListItemView[]> {
  const processes = await prisma.importProcess.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      filename: true,
      deckName: true,
      importedCardCount: true,
      rowCount: true,
      createdAt: true,
    },
  })
  return processes.map((p) => ({
    id: p.id,
    status: p.status,
    filename: p.filename,
    deckName: p.deckName ?? null,
    importedCardCount: p.importedCardCount,
    rowCount: p.rowCount,
    createdAt: p.createdAt.toISOString(),
  }))
}

export async function saveImportConfiguration(prisma: PrismaClient, input: SaveConfigurationInput) {
  const process = await findOwnedImportProcess(prisma, input.userId, input.processId)

  if (process.status !== PrismaImportProcessStatus.AWAITING_CONFIGURATION) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This import process can no longer be configured.",
    })
  }

  const selectedCount = input.cardTypes.filter((cardType) => cardType.selected).length

  if (selectedCount === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select at least one card type to import.",
    })
  }

  await assertLanguagesExist(
    prisma,
    [input.deck.defaultFrontLanguageId, input.deck.defaultBackLanguageId].filter(
      (value): value is number => typeof value === "number"
    )
  )

  const processCardTypes = new Map(
    process.cardTypes.map((cardType) => [cardType.modelKey, cardType])
  )
  const selectedRowCount = input.cardTypes
    .filter((cardType) => cardType.selected)
    .reduce((sum, cardType) => sum + (processCardTypes.get(cardType.modelKey)?.rowCount ?? 0), 0)

  await prisma.$transaction(async (tx) => {
    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        deckName: input.deck.name.trim(),
        defaultFrontLanguageId: input.deck.defaultFrontLanguageId ?? null,
        defaultBackLanguageId: input.deck.defaultBackLanguageId ?? null,
        inverseReviewEnabled: input.deck.inverseReviewEnabled ?? false,
        selectedRowCount,
        errorSummary: null,
        errorDetailsJson: null,
      },
    })

    for (const mapping of input.cardTypes) {
      const cardType = processCardTypes.get(mapping.modelKey)

      if (!cardType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown card type mapping: ${mapping.modelKey}`,
        })
      }

      const fieldNames = parseJsonArray<string>(cardType.fieldNamesJson)
      const subjectField = mapping.selected ? (mapping.subjectField ?? null) : null
      const cardMappings = mapping.selected ? (mapping.cardMappings ?? []) : []

      if (mapping.selected) {
        if (!subjectField || !fieldNames.includes(subjectField)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid subject field for model ${cardType.modelName}.`,
          })
        }
        if (cardMappings.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No card mappings configured for ${cardType.modelName}.`,
          })
        }
        for (const cm of cardMappings) {
          for (const fieldName of [cm.frontField, cm.backField]) {
            if (!fieldName || !fieldNames.includes(fieldName)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Invalid mapping field for model ${cardType.modelName}.`,
              })
            }
          }
        }
      }

      const sampleRows = parseJsonArray<Record<string, string>>(cardType.sampleRowsJson)
      const previewCards =
        mapping.selected && subjectField
          ? sampleRows
              .slice(0, 2)
              .flatMap((sampleRow) =>
                cardMappings.map((cm) =>
                  mapPreviewCard(sampleRow, {
                    subjectField,
                    frontField: cm.frontField,
                    backField: cm.backField,
                  })
                )
              )
              .filter((card) => card.subjectText && card.front && card.back)
              .slice(0, 4)
          : []

      const plugins = mapping.selected ? (mapping.plugins ?? []) : []

      await tx.importCardType.update({
        where: { id: cardType.id },
        data: {
          selected: mapping.selected,
          subjectField,
          cardMappingsJson: JSON.stringify(cardMappings),
          pluginsJson: JSON.stringify(plugins),
          previewCardsJson: JSON.stringify(previewCards),
        },
      })
    }
  })

  return getImportProcessView(prisma, input.userId, process.id)
}

export async function startImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await findOwnedImportProcess(prisma, userId, processId)

  if (process.status !== PrismaImportProcessStatus.AWAITING_CONFIGURATION) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This import process cannot be started.",
    })
  }

  if (!process.deckName) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The new deck configuration is incomplete.",
    })
  }

  const selectedTypes = process.cardTypes.filter((cardType) => cardType.selected)
  if (selectedTypes.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select at least one card type to import.",
    })
  }

  for (const cardType of selectedTypes) {
    if (!cardType.subjectField) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No subject field configured for ${cardType.modelName}.`,
      })
    }
    const cardMappings = parseJsonArray<AnkiCardMapping>(cardType.cardMappingsJson)
    if (cardMappings.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No card mappings configured for ${cardType.modelName}.`,
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.workerJob.create({
      data: {
        processId: process.id,
        type: WorkerJobType.RUN_ANKI_IMPORT,
      },
    })

    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        status: PrismaImportProcessStatus.VALIDATING,
        errorSummary: null,
        errorDetailsJson: null,
        failedRowCount: 0,
      },
    })
  })

  return getImportProcessView(prisma, userId, process.id)
}

function collectMappedRows(input: { archiveData: AnkiArchiveData; cardTypes: StoredCardType[] }) {
  const rows: MappedImportRow[] = []
  const sampleErrors: string[] = []
  let failedRowCount = 0
  const seen = new Set<string>()

  const pushError = (message: string) => {
    failedRowCount += 1
    if (sampleErrors.length < 20) {
      sampleErrors.push(message)
    }
  }

  for (const cardType of input.cardTypes) {
    const subjectField = cardType.subjectField
    const cardMappings = parseJsonArray<AnkiCardMapping>(cardType.cardMappingsJson)
    const plugins = parseJsonArray<ImportPlugin>(cardType.pluginsJson)
    if (!subjectField || cardMappings.length === 0) {
      pushError(`No card mappings configured for ${cardType.modelName}.`)
      continue
    }

    const archiveRows = input.archiveData.rowsByModelKey.get(cardType.modelKey) ?? []

    archiveRows.forEach((row, rowIndex) => {
      cardMappings.forEach((cm, cmIndex) => {
        const subjectText = stripMediaAndMarkup(row.values[subjectField] ?? "")
        const rawFront = stripMediaAndMarkup(row.values[cm.frontField] ?? "")
        const rawBack = stripMediaAndMarkup(row.values[cm.backField] ?? "")

        if (!subjectText || !rawFront || !rawBack) {
          return
        }

        const front = applyPlugins(rawFront, "front", plugins, row.values)
        const back = applyPlugins(rawBack, "back", plugins, row.values)

        const subjectKey = subjectKeyFor(subjectText)
        const frontHash = hashFront(front)
        const duplicateKey = `${subjectKey}\u0000${frontHash}`

        if (seen.has(duplicateKey)) {
          pushError(
            `${cardType.modelName} row ${rowIndex + 1} mapping ${cmIndex + 1} duplicates another mapped card.`
          )
          return
        }

        seen.add(duplicateKey)
        rows.push({ subjectText, subjectKey, front, frontHash, back })
      })
    })
  }

  return {
    rows,
    failedRowCount,
    sampleErrors,
  }
}

async function failImportProcess(
  prisma: PrismaClient,
  process: { id: string; storagePath: string },
  summary: string,
  details: string[] = [],
  failedRowCount = 0
) {
  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.FAILED,
      errorSummary: summary,
      errorDetailsJson: JSON.stringify(details),
      failedRowCount,
      completedAt: new Date(),
    },
  })
  await deleteFileIfExists(process.storagePath)
}

export async function runAnalyzeAnkiImportJob(prisma: PrismaClient, processId: string) {
  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
  })

  if (!process) {
    throw new Error(`Import process ${processId} was not found.`)
  }

  const archiveData = await readAnkiArchiveData(process.storagePath)
  const cardTypes = [...archiveData.models.values()].map((model) => {
    const rows = archiveData.rowsByModelKey.get(model.key) ?? []

    return {
      processId: process.id,
      modelKey: model.key,
      modelName: model.name,
      modelKind: model.kind === "CLOZE" ? ImportCardTypeKind.CLOZE : ImportCardTypeKind.BASIC,
      rowCount: rows.length,
      fieldNamesJson: JSON.stringify(model.fieldNames),
      sampleRowsJson: JSON.stringify(rows.slice(0, 2).map((row) => row.values)),
    }
  })

  await prisma.$transaction(async (tx) => {
    await tx.importCardType.deleteMany({ where: { processId: process.id } })

    if (cardTypes.length > 0) {
      await tx.importCardType.createMany({ data: cardTypes })
    }

    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        detectedCollectionFile: archiveData.collectionFile,
        rowCount: [...archiveData.rowsByModelKey.values()].reduce(
          (sum, rows) => sum + rows.length,
          0
        ),
        selectedRowCount: 0,
        importedCardCount: 0,
        failedRowCount: 0,
        errorSummary: null,
        errorDetailsJson: null,
        status: PrismaImportProcessStatus.AWAITING_CONFIGURATION,
      },
    })
  })
}

export async function runImportAnkiImportJob(prisma: PrismaClient, processId: string) {
  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
    include: { cardTypes: true },
  })

  if (!process) {
    throw new Error(`Import process ${processId} was not found.`)
  }

  if (!process.deckName) {
    await failImportProcess(prisma, process, "The deck configuration is incomplete.")
    return
  }

  const selectedCardTypes = process.cardTypes.filter((cardType) => cardType.selected)
  if (selectedCardTypes.length === 0) {
    await failImportProcess(prisma, process, "No card types were selected for import.")
    return
  }

  const languageIds = [process.defaultFrontLanguageId, process.defaultBackLanguageId].filter(
    (value): value is number => typeof value === "number"
  )

  const [existingDeck, languageCount, archiveData] = await Promise.all([
    prisma.deck.findFirst({
      where: {
        userId: process.userId,
        name: process.deckName,
      },
      select: { id: true },
    }),
    prisma.language.count({
      where: { id: { in: Array.from(new Set(languageIds)) } },
    }),
    readAnkiArchiveData(process.storagePath),
  ])

  if (existingDeck) {
    await failImportProcess(prisma, process, "A deck with that name already exists.", [
      "Choose another deck name and upload the file again.",
    ])
    return
  }

  if (languageCount !== Array.from(new Set(languageIds)).length) {
    await failImportProcess(prisma, process, "One of the selected deck languages no longer exists.")
    return
  }

  const mappedRows = collectMappedRows({
    archiveData,
    cardTypes: selectedCardTypes,
  })

  if (mappedRows.failedRowCount > 0) {
    await failImportProcess(
      prisma,
      process,
      "Import validation failed.",
      mappedRows.sampleErrors,
      mappedRows.failedRowCount
    )
    return
  }

  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.IMPORTING,
      failedRowCount: 0,
      errorSummary: null,
      errorDetailsJson: null,
    },
  })

  const importResult = await prisma.$transaction(async (tx) => {
    const deck = await tx.deck.create({
      data: {
        name: process.deckName!,
        userId: process.userId,
        defaultFrontLanguageId: process.defaultFrontLanguageId ?? null,
        defaultBackLanguageId: process.defaultBackLanguageId ?? null,
        inverseReviewEnabled: process.inverseReviewEnabled ?? false,
      },
    })

    const subjectCache = new Map<string, string>()

    for (const row of mappedRows.rows) {
      let subjectId = subjectCache.get(row.subjectKey)

      if (!subjectId) {
        const subject = await tx.subject.upsert({
          where: {
            deckId_subjectKey: {
              deckId: deck.id,
              subjectKey: row.subjectKey,
            },
          },
          update: {},
          create: {
            userId: process.userId,
            deckId: deck.id,
            subject: row.subjectText,
            subjectKey: row.subjectKey,
            randomKey: randomSubjectKey(),
          },
        })

        subjectId = subject.id
        subjectCache.set(row.subjectKey, subject.id)
      }

      await tx.card.create({
        data: {
          deckId: deck.id,
          subjectId,
          front: row.front,
          frontHash: row.frontHash,
          back: row.back,
          genTemplate: null,
        },
      })
    }

    return {
      deckId: deck.id,
      importedCardCount: mappedRows.rows.length,
    }
  })

  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.SUCCEEDED,
      createdDeckId: importResult.deckId,
      importedCardCount: importResult.importedCardCount,
      failedRowCount: 0,
      errorSummary: null,
      errorDetailsJson: null,
      completedAt: new Date(),
    },
  })

  await deleteFileIfExists(process.storagePath)
}

export async function handleAnkiImportWorkerJobError(
  prisma: PrismaClient,
  processId: string | null,
  message: string
) {
  if (!processId) {
    return
  }

  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
    select: { id: true, status: true, storagePath: true },
  })

  if (process && process.status !== PrismaImportProcessStatus.SUCCEEDED) {
    await failImportProcess(prisma, process, message)
  }
}
