import { createFileRoute } from "@tanstack/react-router"
import { CardNewPage } from "../../domains/Cards/CardNewPage"

export const Route = createFileRoute("/(app)/decks/$deckId/cards/new")({
  component: CardNewPage,
})
