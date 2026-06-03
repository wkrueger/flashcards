import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportUploadPage } from "../../domains/AnkiImport/AnkiImportUploadPage"

export const Route = createFileRoute("/(app)/imports/anki/new")({
  component: AnkiImportUploadPage,
})
