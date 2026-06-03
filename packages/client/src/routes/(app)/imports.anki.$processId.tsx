import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportProcessPage } from "../../domains/AnkiImport/AnkiImportProcessPage"

export const Route = createFileRoute("/(app)/imports/anki/$processId")({
  component: AnkiImportProcessPage,
})
