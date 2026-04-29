import { createFileRoute } from "@tanstack/react-router"
import { DeckDetailPage } from "../../domains/decks/deck-detail.page"

export const Route = createFileRoute("/(app)/decks/$deckId/")({
  component: DeckDetailPage,
})
