import { createFileRoute } from "@tanstack/react-router"
import { CardTemplateGeneratePage } from "../domains/cards/card-template-generate.page"

export const Route = createFileRoute("/decks/$deckId/cards/generate")({
  component: CardTemplateGeneratePage,
})
