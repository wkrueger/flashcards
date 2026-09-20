import { createFileRoute } from "@tanstack/react-router"
import { BookUploadPage } from "../../domains/Books/BookUploadPage"

export const Route = createFileRoute("/(app)/books/new")({
  component: BookUploadPage,
})
