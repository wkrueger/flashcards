import { createFileRoute } from "@tanstack/react-router"
import { CardTemplateGeneratePage } from "../../domains/Cards/CardTemplateGeneratePage"

export const Route = createFileRoute("/(app)/decks/$deckId/cards/generate")({
  component: CardTemplateGeneratePage,
})
