import ExcelJS from "exceljs"
import type { DeckSpreadsheetBatchItem, DeckSpreadsheetBatchView } from "@cards/shared"
import {
  SpreadsheetImportStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../../generated/prisma/client.js"
import { DeckSpreadsheetError } from "../deckSpreadsheetShared.js"
import { markDeckCompletionStale } from "../../Decks/deckCompletionService.js"
import { applySpreadsheetRows } from "./importRows.js"
import { assertOwnDeck, resolveLanguageIdByName } from "./index.js"
import { cleanupStaleSpreadsheetImports } from "./storage.js"
import { readCardRows, readMetaConfig } from "./workbook.js"

type BatchConfirmItem = { importId: string; mode: "update" | "create"; name?: string }

export async function getDeckSpreadsheetBatch(
  prisma: PrismaClient,
  userId: string,
  batchId: string
): Promise<DeckSpreadsheetBatchView> {
  const rows = await prisma.spreadsheetImport.findMany({
    where: { batchId, userId },
    orderBy: { createdAt: "asc" },
  })
  if (rows.length === 0) {
    throw new DeckSpreadsheetError("Spreadsheet import batch not found.", "NOT_FOUND")
  }

  const workerJobId = rows.find((row) => row.workerJobId)?.workerJobId ?? null
  const workerJob = workerJobId
    ? await prisma.workerJob.findUnique({
        where: { id: workerJobId },
        select: { status: true, error: true },
      })
    : null
  const jobFailed = workerJob?.status === "FAILED"

  const items: DeckSpreadsheetBatchItem[] = []
  for (const row of rows) {
    const status = jobFailed ? "FAILED" : row.status
    const item: DeckSpreadsheetBatchItem = {
      importId: row.id,
      filename: row.filename,
      status,
      metaDeckId: null,
      suggestedName: "",
      existingDeck: null,
      rowCount: row.rowCount,
      createdCardCount: row.createdCardCount,
      updatedCardCount: row.updatedCardCount,
      deletedCardCount: row.deletedCardCount,
      errorSummary: row.errorSummary ?? (jobFailed ? (workerJob?.error ?? null) : null),
    }

    // Only unconfirmed items need the Meta-derived review fields; this branch
    // is never hit on the post-confirm polling path (those rows are IMPORTING
    // or terminal), so we never re-read workbooks on an interval.
    if (row.status === SpreadsheetImportStatus.UPLOADED) {
      try {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(row.storagePath)
        const config = readMetaConfig(workbook)
        let existingDeck: { id: string; name: string } | null = null
        if (config.deckId) {
          existingDeck = await prisma.deck.findFirst({
            where: { id: config.deckId, userId },
            select: { id: true, name: true },
          })
        }
        item.metaDeckId = config.deckId || null
        item.suggestedName = config.name || existingDeck?.name || ""
        item.existingDeck = existingDeck
      } catch (error) {
        item.status = "FAILED"
        item.errorSummary =
          error instanceof Error ? error.message : "Could not read the spreadsheet."
      }
    }

    items.push(item)
  }

  const batchStatus = jobFailed
    ? "FAILED"
    : items.every((item) => item.status === "SUCCEEDED")
      ? "SUCCEEDED"
      : items.some((item) => item.status === "IMPORTING")
        ? "IMPORTING"
        : "UPLOADED"

  return {
    batchId,
    status: batchStatus,
    errorSummary: jobFailed ? (workerJob?.error ?? null) : null,
    items,
  }
}

// Validates the entire batch up front and only then enqueues a single worker
// job. Nothing is created here — deck creation happens inside the worker
// transaction so a later failure rolls everything back (all-or-nothing).
export async function confirmDeckSpreadsheetImportBatch(
  prisma: PrismaClient,
  userId: string,
  input: { items: BatchConfirmItem[] }
): Promise<{ batchId: string; importIds: string[] }> {
  const importIds = input.items.map((item) => item.importId)
  const rows = await prisma.spreadsheetImport.findMany({
    where: { id: { in: importIds }, userId },
  })
  if (rows.length !== input.items.length) {
    throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")
  }
  const batchId = rows[0]?.batchId ?? null
  const batchIds = new Set(rows.map((row) => row.batchId))
  if (batchIds.size !== 1 || batchId === null) {
    throw new DeckSpreadsheetError("Items must belong to a single batch.", "BAD_REQUEST")
  }
  if (rows.some((row) => row.workerJobId)) {
    throw new DeckSpreadsheetError("This batch was already started.", "BAD_REQUEST")
  }

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const plans: Array<{ importId: string; deckId: string | null; pendingDeckName: string | null }> =
    []
  const newDeckNames = new Set<string>()

  for (const item of input.items) {
    const row = rowById.get(item.importId)!
    const config = await readStoredMetaConfig(row.storagePath)

    if (item.mode === "create") {
      const name = (item.name ?? "").trim()
      if (!name) throw new DeckSpreadsheetError("A deck name is required.", "BAD_REQUEST")
      const lowered = name.toLowerCase()
      if (newDeckNames.has(lowered)) {
        throw new DeckSpreadsheetError(
          `Two spreadsheets both create a deck named "${name}".`,
          "CONFLICT"
        )
      }
      newDeckNames.add(lowered)
      const existing = await prisma.deck.findFirst({ where: { userId, name } })
      if (existing) {
        throw new DeckSpreadsheetError(`A deck named "${name}" already exists.`, "CONFLICT")
      }
      plans.push({ importId: row.id, deckId: null, pendingDeckName: name })
    } else {
      if (!config.deckId) {
        throw new DeckSpreadsheetError(`"${row.filename}" has no deckId to update.`, "BAD_REQUEST")
      }
      const deck = await prisma.deck.findFirst({
        where: { id: config.deckId, userId },
        select: { id: true },
      })
      if (!deck) {
        throw new DeckSpreadsheetError(`Deck for "${row.filename}" was not found.`, "NOT_FOUND")
      }
      plans.push({ importId: row.id, deckId: deck.id, pendingDeckName: null })
    }
  }

  await prisma.$transaction(async (tx) => {
    const job = await tx.workerJob.create({
      data: { type: WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT_BATCH },
    })
    for (const plan of plans) {
      await tx.spreadsheetImport.update({
        where: { id: plan.importId },
        data: {
          deckId: plan.deckId,
          pendingDeckName: plan.pendingDeckName,
          ignoreRowIds: plan.pendingDeckName !== null,
          workerJobId: job.id,
        },
      })
    }
  })

  return { batchId, importIds }
}

export async function runDeckSpreadsheetImportBatchJob(prisma: PrismaClient, workerJobId: string) {
  await cleanupStaleSpreadsheetImports(prisma)

  const rows = await prisma.spreadsheetImport.findMany({
    where: { workerJobId },
    orderBy: { createdAt: "asc" },
  })
  const firstRow = rows[0]
  if (!firstRow) {
    throw new Error("Spreadsheet import batch was not found for this worker job.")
  }
  const userId = firstRow.userId

  await prisma.spreadsheetImport.updateMany({
    where: { workerJobId },
    data: { status: SpreadsheetImportStatus.IMPORTING },
  })

  const outcomes = await prisma.$transaction(async (tx) => {
    const results: Array<{
      id: string
      deckId: string
      rowCount: number
      createdCardCount: number
      updatedCardCount: number
      deletedCardCount: number
    }> = []

    for (const row of rows) {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(row.storagePath)
      const cardRows = readCardRows(workbook)

      let deckId: string
      if (row.ignoreRowIds && row.pendingDeckName) {
        const config = readMetaConfig(workbook)
        const existing = await tx.deck.findFirst({
          where: { userId, name: row.pendingDeckName },
          select: { id: true },
        })
        if (existing) {
          throw new Error(`A deck named "${row.pendingDeckName}" already exists.`)
        }
        const deck = await tx.deck.create({
          data: {
            name: row.pendingDeckName,
            userId,
            defaultFrontLanguageId: await resolveLanguageIdByName(tx, config.defaultFrontLanguage),
            defaultBackLanguageId: await resolveLanguageIdByName(tx, config.defaultBackLanguage),
            speechRecognitionEnabled: config.speechRecognitionEnabled,
            inverseReviewEnabled: config.inverseReviewEnabled,
            sequentialEnabled: config.sequentialEnabled,
          },
        })
        deckId = deck.id
      } else {
        if (!row.deckId) {
          throw new Error(`"${row.filename}" has no deck to update.`)
        }
        await assertOwnDeck(tx, userId, row.deckId)
        deckId = row.deckId
      }

      const result = await applySpreadsheetRows(tx, {
        userId,
        deckId,
        rows: cardRows,
        ignoreRowIds: row.ignoreRowIds,
      })
      results.push({ id: row.id, deckId, ...result })
    }

    return results
  })

  const completedAt = new Date()
  for (const outcome of outcomes) {
    await prisma.spreadsheetImport.update({
      where: { id: outcome.id },
      data: {
        deckId: outcome.deckId,
        status: SpreadsheetImportStatus.SUCCEEDED,
        rowCount: outcome.rowCount,
        createdCardCount: outcome.createdCardCount,
        updatedCardCount: outcome.updatedCardCount,
        deletedCardCount: outcome.deletedCardCount,
        errorSummary: null,
        errorDetailsJson: null,
        completedAt,
      },
    })
    await markDeckCompletionStale(prisma, outcome.deckId)
  }
}

export async function handleDeckSpreadsheetImportBatchWorkerJobError(
  prisma: PrismaClient,
  workerJobId: string,
  message: string
) {
  await prisma.spreadsheetImport.updateMany({
    where: { workerJobId },
    data: {
      status: SpreadsheetImportStatus.FAILED,
      errorSummary: message,
      completedAt: new Date(),
    },
  })
}

async function readStoredMetaConfig(storagePath: string) {
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(storagePath)
    return readMetaConfig(workbook)
  } catch (error) {
    throw new DeckSpreadsheetError(
      error instanceof Error ? error.message : "Could not read the spreadsheet.",
      "BAD_REQUEST"
    )
  }
}
