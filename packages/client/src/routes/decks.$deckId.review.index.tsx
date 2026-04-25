import { createFileRoute } from "@tanstack/react-router"
import { ReviewPage } from "../domains/review/review.page"

export const Route = createFileRoute("/decks/$deckId/review/")({
  component: () => <ReviewPage mode="normal" />,
})
