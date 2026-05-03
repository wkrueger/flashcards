import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportListPage } from "../../domains/anki-import/anki-import-list.page"

export const Route = createFileRoute("/(app)/imports/anki/")({
  component: AnkiImportListPage,
})
