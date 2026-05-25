import { createFileRoute, useParams, useSearch } from "@tanstack/react-router"
import { reviewModeSchema } from "@cards/shared"
import { ReviewPage } from "../../domains/review/review.page"

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
    const mode = reviewModeSchema.safeParse(search.mode)
    return { mode: mode.success ? mode.data : "normal" }
  },
  component: CardReviewRoute,
})
