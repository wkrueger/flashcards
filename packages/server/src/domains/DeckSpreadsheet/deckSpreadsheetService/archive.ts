import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"

import AdmZip from "adm-zip"
import ExcelJS from "exceljs"
import type { DeckSpreadsheetBatchItem } from "@cards/shared"
import { SpreadsheetImportStatus, type PrismaClient } from "../../../generated/prisma/client.js"
import {
  DECK_SPREADSHEET_UPLOAD_DIR,
  DECK_SPREADSHEET_UPLOAD_MAX_BYTES,
  DeckSpreadsheetError,
  deleteFileIfExists,
} from "../deckSpreadsheetShared.js"
import { readMetaConfig } from "./workbook.js"

export const DECK_SPREADSHEET_ARCHIVE_MAX_ENTRIES = 100

// Extracts every .xlsx entry from an uploaded zip, stores each as its own
// SpreadsheetImport row sharing a fresh batchId, and inspects each one so the
// review UI can suggest create-vs-update per file. Inspection is tolerant: a
// file with an unreadable Meta sheet is surfaced with an error instead of
// aborting the whole batch.
export async function extractSpreadsheetArchive(
  prisma: PrismaClient,
  input: { userId: string; archivePath: string }
): Promise<{ batchId: string; items: DeckSpreadsheetBatchItem[] }> {
  const entries = readArchiveEntries(input.archivePath)
  if (entries.length === 0) {
    throw new DeckSpreadsheetError("The zip contains no .xlsx spreadsheets.", "BAD_REQUEST")
  }
  if (entries.length > DECK_SPREADSHEET_ARCHIVE_MAX_ENTRIES) {
    throw new DeckSpreadsheetError(
      `The zip contains more than ${DECK_SPREADSHEET_ARCHIVE_MAX_ENTRIES} spreadsheets.`,
      "BAD_REQUEST"
    )
  }

  const uploadDir = resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
  await mkdir(uploadDir, { recursive: true })

  const batchId = randomUUID()
  const items: DeckSpreadsheetBatchItem[] = []
  const writtenPaths: string[] = []

  try {
    for (const entry of entries) {
      const data = entry.getData()
      if (data.length > DECK_SPREADSHEET_UPLOAD_MAX_BYTES) {
        throw new DeckSpreadsheetError(`"${entry.filename}" exceeds the 20MB limit.`, "BAD_REQUEST")
      }

      const storagePath = join(uploadDir, `${Date.now()}-${randomUUID()}.xlsx`)
      await writeFile(storagePath, data)
      writtenPaths.push(storagePath)

      const record = await prisma.spreadsheetImport.create({
        data: {
          userId: input.userId,
          deckId: null,
          batchId,
          filename: entry.filename,
          fileSize: data.length,
          storagePath,
          status: SpreadsheetImportStatus.UPLOADED,
        },
      })

      items.push(
        await inspectArchiveItem(prisma, input.userId, record.id, record.filename, storagePath)
      )
    }
  } catch (error) {
    await Promise.all(writtenPaths.map((path) => deleteFileIfExists(path)))
    await prisma.spreadsheetImport.deleteMany({ where: { batchId, userId: input.userId } })
    throw error
  }

  return { batchId, items }
}

function readArchiveEntries(archivePath: string) {
  const archive = new AdmZip(archivePath)
  return archive
    .getEntries()
    .filter((entry) => {
      if (entry.isDirectory) return false
      const name = basename(entry.entryName)
      if (name.startsWith(".")) return false
      if (entry.entryName.split("/").includes("__MACOSX")) return false
      return extname(name).toLowerCase() === ".xlsx"
    })
    .map((entry) => ({
      filename: basename(entry.entryName),
      getData: () => entry.getData(),
    }))
}

async function inspectArchiveItem(
  prisma: PrismaClient,
  userId: string,
  importId: string,
  filename: string,
  storagePath: string
): Promise<DeckSpreadsheetBatchItem> {
  const base: DeckSpreadsheetBatchItem = {
    importId,
    filename,
    status: "UPLOADED",
    metaDeckId: null,
    suggestedName: "",
    existingDeck: null,
    rowCount: 0,
    createdCardCount: 0,
    updatedCardCount: 0,
    deletedCardCount: 0,
    errorSummary: null,
  }

  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(storagePath)
    const config = readMetaConfig(workbook)

    let existingDeck: { id: string; name: string } | null = null
    if (config.deckId) {
      existingDeck = await prisma.deck.findFirst({
        where: { id: config.deckId, userId },
        select: { id: true, name: true },
      })
    }

    return {
      ...base,
      metaDeckId: config.deckId || null,
      suggestedName: config.name || existingDeck?.name || "",
      existingDeck,
    }
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      errorSummary: error instanceof Error ? error.message : "Could not read the spreadsheet.",
    }
  }
}
