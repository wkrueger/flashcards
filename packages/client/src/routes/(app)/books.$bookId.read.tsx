import { createFileRoute } from "@tanstack/react-router"
import { BookReaderPage } from "../../domains/Books/BookReaderPage"

type Search = {
  page: number
}

export const Route = createFileRoute("/(app)/books/$bookId/read")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const page = Number(search.page)
    return { page: Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0 }
  },
  component: BookReaderPage,
})
