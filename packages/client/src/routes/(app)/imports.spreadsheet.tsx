import { createFileRoute } from "@tanstack/react-router"
import { DeckSpreadsheetNewImportPage } from "../../domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage"

export const Route = createFileRoute("/(app)/imports/spreadsheet")({
  component: DeckSpreadsheetNewImportPage,
})
