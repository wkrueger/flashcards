import { createFileRoute } from "@tanstack/react-router"
import { DeckSpreadsheetImportPage } from "../../domains/deck-spreadsheet/deck-spreadsheet-import.page"

export const Route = createFileRoute("/(app)/decks/$deckId/import")({
  component: DeckSpreadsheetImportPage,
})
