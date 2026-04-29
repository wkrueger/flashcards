import { createFileRoute } from "@tanstack/react-router"
import { CardNewPage } from "../../domains/cards/card-new.page"

export const Route = createFileRoute("/(app)/decks/$deckId/cards/new")({
  component: CardNewPage,
})
