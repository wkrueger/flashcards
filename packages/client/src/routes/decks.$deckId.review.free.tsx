import { createFileRoute } from "@tanstack/react-router"
import { ReviewPage } from "../domains/review/review.page"

export const Route = createFileRoute("/decks/$deckId/review/free")({
  component: () => <ReviewPage mode="free" />,
})
