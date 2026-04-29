import { createFileRoute } from "@tanstack/react-router"
import { DeckListPage } from "../../domains/decks/deck-list.page"

export const Route = createFileRoute("/(app)/")({
  component: DeckListPage,
})
