import ExcelJS from "exceljs"
import { TRPCError } from "@trpc/server"
import {
  Prisma,
  SpreadsheetImportStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../../generated/prisma/client.js"
import { DeckSpreadsheetError } from "../deckSpreadsheetShared.js"
import type { DeckSpreadsheetInspectResult, SpreadsheetImportStatusView } from "@cards/shared"
import { applySpreadsheetRows } from "./importRows.js"
import { markDeckCompletionStale } from "../../Decks/deckCompletionService.js"
import { cleanupStaleSpreadsheetImports as cleanupStaleSpreadsheetImportsForStorage } from "./storage.js"
import {
  CARD_HEADERS,
  META_CONFIG_KEYS,
  assertNoDuplicateTagNames,
  readCardRows,
  readMetaConfig,
  readMetaDeckId,
} from "./workbook.js"

type DbClient = PrismaClient | Prisma.TransactionClient

export async function buildDeckSpreadsheetExport(
  prisma: PrismaClient,
  userId: string,
  deckId: string
) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId },
    include: {
      defaultFrontLanguage: { select: { name: true } },
      defaultBackLanguage: { select: { name: true } },
    },
  })
  if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")

  const cards = await prisma.card.findMany({
    where: { deckId },
    orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: {
      subject: { select: { subject: true, order: true } },
      cardTags: { include: { tag: { select: { id: true, name: true } } } },
    },
  })

  assertNoDuplicateTagNames(cards.flatMap((card) => card.cardTags.map((cardTag) => cardTag.tag)))

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Cards"
  workbook.created = new Date()

  addMetaSheet(workbook, {
    deckId: deck.id,
    name: deck.name,
    frontLanguage: deck.defaultFrontLanguage?.name ?? "",
    backLanguage: deck.defaultBackLanguage?.name ?? "",
    speechRecognitionEnabled: deck.speechRecognitionEnabled,
    inverseReviewEnabled: deck.inverseReviewEnabled,
    sequentialEnabled: deck.sequentialEnabled,
  })

  const cardSheet = workbook.addWorksheet("Card")
  cardSheet.addRow([...CARD_HEADERS])
  for (const card of cards) {
    cardSheet.addRow([
      card.id,
      card.subject.subject,
      card.subject.order ?? "",
      card.front,
      card.back,
      card.order ?? "",
      card.cardTags
        .map((cardTag) => cardTag.tag.name)
        .sort()
        .join(", "),
    ])
  }
  cardSheet.columns = [
    { width: 28 },
    { width: 24 },
    { width: 12 },
    { width: 48 },
    { width: 48 },
    { width: 12 },
    { width: 28 },
  ]

  const buffer = await workbook.xlsx.writeBuffer()
  const safeDeckName = deck.name.replaceAll(/[^a-z0-9_-]+/gi, "-").replaceAll(/^-|-$/g, "")
  return {
    filename: `${safeDeckName || "deck"}-${deck.id}.xlsx`,
    buffer: Buffer.from(buffer),
  }
}

export async function getSpreadsheetImportStatus(
  prisma: PrismaClient,
  userId: string,
  importId: string
) {
  const item = await prisma.spreadsheetImport.findFirst({
    where: { id: importId, userId },
  })

  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Spreadsheet import not found." })
  }

  const workerJob = item.workerJobId
    ? await prisma.workerJob.findUnique({
        where: { id: item.workerJobId },
        select: { id: true, status: true, error: true },
      })
    : null

  return {
    jobId: workerJob?.id ?? item.workerJobId ?? "",
    importId: item.id,
    deckId: item.deckId,
    status: workerJob?.status === "FAILED" ? "FAILED" : item.status,
    filename: item.filename,
    rowCount: item.rowCount,
    createdCardCount: item.createdCardCount,
    updatedCardCount: item.updatedCardCount,
    deletedCardCount: item.deletedCardCount,
    errorSummary: item.errorSummary ?? workerJob?.error ?? null,
    errorDetails: item.errorDetailsJson ? (JSON.parse(item.errorDetailsJson) as string[]) : [],
  } satisfies SpreadsheetImportStatusView
}

export async function enqueueDeckSpreadsheetImportJob(
  prisma: PrismaClient,
  input: {
    deckId: string
    userId: string
    importId: string
  }
) {
  await assertOwnDeck(prisma, input.userId, input.deckId)

  const spreadsheetImport = await prisma.$transaction(async (tx) => {
    const item = await tx.spreadsheetImport.findFirst({
      where: {
        id: input.importId,
        userId: input.userId,
        deckId: input.deckId,
      },
    })
    if (!item) throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")

    const job = await tx.workerJob.create({
      data: {
        type: WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT,
      },
    })

    return tx.spreadsheetImport.update({
      where: { id: item.id },
      data: { workerJobId: job.id },
    })
  })

  return { importId: spreadsheetImport.id }
}

export async function runDeckSpreadsheetImportJob(prisma: PrismaClient, workerJobId: string) {
  await cleanupStaleSpreadsheetImportsForStorage(prisma)

  const spreadsheetImport = await prisma.spreadsheetImport.findFirst({
    where: { workerJobId },
  })
  if (!spreadsheetImport) {
    throw new Error("Spreadsheet import was not found for this worker job.")
  }

  await prisma.spreadsheetImport.update({
    where: { id: spreadsheetImport.id },
    data: { status: SpreadsheetImportStatus.IMPORTING },
  })

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(spreadsheetImport.storagePath)
  if (!spreadsheetImport.ignoreRowIds) {
    const metaDeckId = readMetaDeckId(workbook)
    if (metaDeckId !== spreadsheetImport.deckId) {
      throw new Error("Spreadsheet deckId does not match this deck.")
    }
  }
  const rows = readCardRows(workbook)

  const result = await prisma.$transaction(async (tx) => {
    await assertOwnDeck(tx, spreadsheetImport.userId, spreadsheetImport.deckId!)
    return applySpreadsheetRows(tx, {
      userId: spreadsheetImport.userId,
      deckId: spreadsheetImport.deckId!,
      rows,
      ignoreRowIds: spreadsheetImport.ignoreRowIds,
    })
  })

  await prisma.spreadsheetImport.update({
    where: { id: spreadsheetImport.id },
    data: {
      status: SpreadsheetImportStatus.SUCCEEDED,
      rowCount: result.rowCount,
      createdCardCount: result.createdCardCount,
      updatedCardCount: result.updatedCardCount,
      deletedCardCount: result.deletedCardCount,
      errorSummary: null,
      errorDetailsJson: null,
      completedAt: new Date(),
    },
  })
  await markDeckCompletionStale(prisma, spreadsheetImport.deckId!)
}

export async function handleDeckSpreadsheetImportWorkerJobError(
  prisma: PrismaClient,
  workerJobId: string,
  message: string
) {
  const spreadsheetImport = await prisma.spreadsheetImport.findFirst({
    where: { workerJobId },
  })

  if (!spreadsheetImport) return

  await prisma.spreadsheetImport.update({
    where: { id: spreadsheetImport.id },
    data: {
      status: SpreadsheetImportStatus.FAILED,
      errorSummary: message,
      errorDetailsJson: JSON.stringify([message]),
      completedAt: new Date(),
    },
  })
}

export { cleanupStaleSpreadsheetImports } from "./storage.js"

export async function buildDeckSpreadsheetTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Cards"
  workbook.created = new Date()

  addMetaSheet(workbook, {
    deckId: "",
    name: "",
    frontLanguage: "",
    backLanguage: "",
    speechRecognitionEnabled: true,
    inverseReviewEnabled: false,
    sequentialEnabled: false,
  })

  const cardSheet = workbook.addWorksheet("Card")
  cardSheet.addRow([...CARD_HEADERS])
  cardSheet.columns = [
    { width: 28 },
    { width: 24 },
    { width: 12 },
    { width: 48 },
    { width: 48 },
    { width: 12 },
    { width: 28 },
  ]

  const buffer = await workbook.xlsx.writeBuffer()
  return { filename: "deck-template.xlsx", buffer: Buffer.from(buffer) }
}

function addMetaSheet(
  workbook: ExcelJS.Workbook,
  config: {
    deckId: string
    name: string
    frontLanguage: string
    backLanguage: string
    speechRecognitionEnabled: boolean
    inverseReviewEnabled: boolean
    sequentialEnabled: boolean
  }
) {
  const meta = workbook.addWorksheet("Meta")
  meta.addRow(["key", "value"])
  meta.addRow([META_CONFIG_KEYS.deckId, config.deckId])
  meta.addRow([META_CONFIG_KEYS.name, config.name])
  meta.addRow([META_CONFIG_KEYS.defaultFrontLanguage, config.frontLanguage])
  meta.addRow([META_CONFIG_KEYS.defaultBackLanguage, config.backLanguage])
  meta.addRow([META_CONFIG_KEYS.speechRecognitionEnabled, String(config.speechRecognitionEnabled)])
  meta.addRow([META_CONFIG_KEYS.inverseReviewEnabled, String(config.inverseReviewEnabled)])
  meta.addRow([META_CONFIG_KEYS.sequentialEnabled, String(config.sequentialEnabled)])
  meta.columns = [{ width: 24 }, { width: 40 }]
}

export async function inspectPendingImport(
  prisma: PrismaClient,
  userId: string,
  importId: string
): Promise<DeckSpreadsheetInspectResult> {
  const item = await prisma.spreadsheetImport.findFirst({ where: { id: importId, userId } })
  if (!item) throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")

  let config
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(item.storagePath)
    config = readMetaConfig(workbook)
  } catch (error) {
    throw new DeckSpreadsheetError(
      error instanceof Error ? error.message : "Could not read the spreadsheet.",
      "BAD_REQUEST"
    )
  }

  let existingDeck: { id: string; name: string } | null = null
  if (config.deckId) {
    existingDeck = await prisma.deck.findFirst({
      where: { id: config.deckId, userId },
      select: { id: true, name: true },
    })
  }

  return {
    importId: item.id,
    metaDeckId: config.deckId || null,
    suggestedName: config.name || existingDeck?.name || "",
    existingDeck,
  }
}

export async function confirmDeckSpreadsheetImport(
  prisma: PrismaClient,
  userId: string,
  input: { importId: string; mode: "update" | "create"; name?: string }
) {
  const item = await prisma.spreadsheetImport.findFirst({
    where: { id: input.importId, userId },
  })
  if (!item) throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")
  if (item.workerJobId) {
    throw new DeckSpreadsheetError("This import was already started.", "BAD_REQUEST")
  }

  let config
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(item.storagePath)
    config = readMetaConfig(workbook)
  } catch (error) {
    throw new DeckSpreadsheetError(
      error instanceof Error ? error.message : "Could not read the spreadsheet.",
      "BAD_REQUEST"
    )
  }

  let deckId: string
  let ignoreRowIds: boolean

  if (input.mode === "create") {
    const name = (input.name ?? "").trim()
    if (!name) throw new DeckSpreadsheetError("A deck name is required.", "BAD_REQUEST")
    const existing = await prisma.deck.findFirst({ where: { userId, name } })
    if (existing) {
      throw new DeckSpreadsheetError("A deck with that name already exists.", "CONFLICT")
    }
    const defaultFrontLanguageId = await resolveLanguageIdByName(
      prisma,
      config.defaultFrontLanguage
    )
    const defaultBackLanguageId = await resolveLanguageIdByName(prisma, config.defaultBackLanguage)
    const deck = await prisma.deck.create({
      data: {
        name,
        userId,
        defaultFrontLanguageId,
        defaultBackLanguageId,
        speechRecognitionEnabled: config.speechRecognitionEnabled,
        inverseReviewEnabled: config.inverseReviewEnabled,
        sequentialEnabled: config.sequentialEnabled,
      },
    })
    deckId = deck.id
    ignoreRowIds = true
  } else {
    if (!config.deckId) {
      throw new DeckSpreadsheetError("The spreadsheet has no deckId to update.", "BAD_REQUEST")
    }
    const deck = await prisma.deck.findFirst({
      where: { id: config.deckId, userId },
      select: { id: true },
    })
    if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")
    deckId = deck.id
    ignoreRowIds = false
  }

  await prisma.$transaction(async (tx) => {
    const job = await tx.workerJob.create({
      data: { type: WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT },
    })
    await tx.spreadsheetImport.update({
      where: { id: item.id },
      data: { deckId, ignoreRowIds, workerJobId: job.id },
    })
  })

  return { importId: item.id, deckId }
}

export async function resolveLanguageIdByName(
  prisma: DbClient,
  name: string
): Promise<number | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const language = await prisma.language.findFirst({
    where: { name: trimmed },
    select: { id: true },
  })
  if (!language) {
    throw new DeckSpreadsheetError(`Language "${trimmed}" was not found.`, "BAD_REQUEST")
  }
  return language.id
}

export async function assertOwnDeck(prisma: DbClient, userId: string, deckId: string) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId },
    select: { id: true, name: true },
  })

  if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")

  return deck
}
