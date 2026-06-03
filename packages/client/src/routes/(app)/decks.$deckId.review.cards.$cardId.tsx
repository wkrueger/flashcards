import { createFileRoute, useParams, useSearch } from "@tanstack/react-router"
import { ReviewPage } from "../../domains/Review/ReviewPage"

type Search = {
  mode: "normal" | "free"
}

function CardReviewRoute() {
  const { cardId } = useParams({ from: "/(app)/decks/$deckId/review/cards/$cardId" })
  const { mode } = useSearch({ from: "/(app)/decks/$deckId/review/cards/$cardId" })
  return <ReviewPage mode={mode} initialCardId={cardId} />
}

export const Route = createFileRoute("/(app)/decks/$deckId/review/cards/$cardId")({
  validateSearch: (search: Record<string, unknown>): Search => {
    return { mode: search.mode === "free" ? "free" : "normal" }
  },
  component: CardReviewRoute,
})
