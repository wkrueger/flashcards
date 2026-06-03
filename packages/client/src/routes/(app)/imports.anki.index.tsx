import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportListPage } from "../../domains/AnkiImport/AnkiImportListPage"

export const Route = createFileRoute("/(app)/imports/anki/")({
  component: AnkiImportListPage,
})
