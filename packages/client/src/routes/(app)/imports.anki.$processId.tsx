import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportProcessPage } from "../../domains/anki-import/anki-import-process.page"

export const Route = createFileRoute("/(app)/imports/anki/$processId")({
  component: AnkiImportProcessPage,
})
