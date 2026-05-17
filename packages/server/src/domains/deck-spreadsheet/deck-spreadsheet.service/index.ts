import ExcelJS from "exceljs"
import { TRPCError } from "@trpc/server"
import {
  Prisma,
  SpreadsheetImportStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../../generated/prisma/client.js"
import { DeckSpreadsheetError } from "../deck-spreadsheet.shared.js"
import type { SpreadsheetImportStatusView } from "@cards/shared"
import { applySpreadsheetRows } from "./import-rows.js"
import { cleanupStaleSpreadsheetImports as cleanupStaleSpreadsheetImportsForStorage } from "./storage.js"
import {
  CARD_HEADERS,
  assertNoDuplicateTagNames,
  readCardRows,
  readMetaDeckId,
} from "./workbook.js"

type DbClient = PrismaClient | Prisma.TransactionClient

export async function buildDeckSpreadsheetExport(
  prisma: PrismaClient,
  userId: string,
  deckId: string
) {
  const deck = await assertOwnDeck(prisma, userId, deckId)
  const cards = await prisma.card.findMany({
    where: { deckId },
    orderBy: { createdAt: "asc" },
    include: {
      subject: { select: { subject: true } },
      cardTags: { include: { tag: { select: { id: true, name: true } } } },
    },
  })

  assertNoDuplicateTagNames(cards.flatMap((card) => card.cardTags.map((cardTag) => cardTag.tag)))

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Cards"
  workbook.created = new Date()

  const meta = workbook.addWorksheet("Meta")
  meta.addRow(["key", "value"])
  meta.addRow(["deckId", deck.id])
  meta.columns = [{ width: 20 }, { width: 40 }]

  const cardSheet = workbook.addWorksheet("Card")
  cardSheet.addRow([...CARD_HEADERS])
  for (const card of cards) {
    cardSheet.addRow([
      card.id,
      card.subject.subject,
      card.front,
      card.back,
      card.cardTags
        .map((cardTag) => cardTag.tag.name)
        .sort()
        .join(", "),
    ])
  }
  cardSheet.columns = [{ width: 28 }, { width: 24 }, { width: 48 }, { width: 48 }, { width: 28 }]

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
  const metaDeckId = readMetaDeckId(workbook)
  if (metaDeckId !== spreadsheetImport.deckId) {
    throw new Error("Spreadsheet deckId does not match this deck.")
  }
  const rows = readCardRows(workbook)

  const result = await prisma.$transaction(async (tx) => {
    await assertOwnDeck(tx, spreadsheetImport.userId, spreadsheetImport.deckId)
    return applySpreadsheetRows(tx, {
      userId: spreadsheetImport.userId,
      deckId: spreadsheetImport.deckId,
      rows,
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

async function assertOwnDeck(prisma: DbClient, userId: string, deckId: string) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId },
    select: { id: true, name: true },
  })

  if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")

  return deck
}
