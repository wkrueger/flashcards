import { createFileRoute } from "@tanstack/react-router"
import { DeckSpreadsheetBatchImportPage } from "../../domains/DeckSpreadsheet/DeckSpreadsheetBatchImportPage"

type BatchImportSearch = {
  batchId: string
  deckId?: string
}

export const Route = createFileRoute("/(app)/imports/spreadsheet-batch")({
  validateSearch: (search: Record<string, unknown>): BatchImportSearch => ({
    batchId: typeof search.batchId === "string" ? search.batchId : "",
    deckId: typeof search.deckId === "string" ? search.deckId : undefined,
  }),
  component: DeckSpreadsheetBatchImportPage,
})
