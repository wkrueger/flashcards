import { createFileRoute } from "@tanstack/react-router"
import { DeckSpreadsheetImportPage } from "../../domains/DeckSpreadsheet/DeckSpreadsheetImportPage"

export const Route = createFileRoute("/(app)/decks/$deckId/import")({
  component: DeckSpreadsheetImportPage,
})
