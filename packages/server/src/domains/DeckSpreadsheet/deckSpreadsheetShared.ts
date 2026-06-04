import { rm } from "node:fs/promises"

export const DECK_SPREADSHEET_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const DECK_SPREADSHEET_UPLOAD_DIR = ".uploads/deck-spreadsheet-imports"
export const SPREADSHEET_IMPORT_CLEANUP_AGE_MS = 60 * 60 * 1000

export type SpreadsheetImportResult = {
  rowCount: number
  createdCardCount: number
  updatedCardCount: number
  deletedCardCount: number
}

export class DeckSpreadsheetError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"
  ) {
    super(message)
  }
}

export async function deleteFileIfExists(storagePath: string | null | undefined) {
  if (!storagePath) return
  await rm(storagePath, { force: true })
}
