import { createFileRoute } from "@tanstack/react-router"
import { CardEditPage } from "../../domains/cards/card-edit.page"

export const Route = createFileRoute("/(app)/decks/$deckId/cards/$cardId/edit")({
  component: CardEditPage,
})
