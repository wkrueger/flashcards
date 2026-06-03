import { createFileRoute } from "@tanstack/react-router"
import { DeckListPage } from "../../domains/Decks/DeckListPage"

export const Route = createFileRoute("/(app)/")({
  component: DeckListPage,
})
