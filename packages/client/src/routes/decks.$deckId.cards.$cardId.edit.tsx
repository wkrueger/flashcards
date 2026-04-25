import { createFileRoute } from "@tanstack/react-router"
import { CardEditPage } from "../domains/cards/card-edit.page"

export const Route = createFileRoute("/decks/$deckId/cards/$cardId/edit")({
  component: CardEditPage,
})
