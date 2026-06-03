import { createFileRoute } from "@tanstack/react-router"
import { DeckDetailPage } from "../../domains/Decks/DeckDetailPage"

export const Route = createFileRoute("/(app)/decks/$deckId/")({
  component: DeckDetailPage,
})
