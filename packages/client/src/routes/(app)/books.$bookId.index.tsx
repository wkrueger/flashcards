import { createFileRoute } from "@tanstack/react-router"
import { BookDetailPage } from "../../domains/Books/BookDetailPage"

export const Route = createFileRoute("/(app)/books/$bookId/")({
  component: BookDetailPage,
})
