import { createFileRoute } from "@tanstack/react-router"
import { ReviewPage } from "../../domains/Review/ReviewPage"

export const Route = createFileRoute("/(app)/decks/$deckId/review/")({
  component: () => <ReviewPage mode="normal" />,
})
