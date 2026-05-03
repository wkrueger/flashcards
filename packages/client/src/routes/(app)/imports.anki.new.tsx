import { createFileRoute } from "@tanstack/react-router"
import { AnkiImportUploadPage } from "../../domains/anki-import/anki-import-upload.page"

export const Route = createFileRoute("/(app)/imports/anki/new")({
  component: AnkiImportUploadPage,
})
