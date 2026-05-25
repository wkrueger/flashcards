import { createFileRoute } from "@tanstack/react-router"
import { CardEditPage } from "../../domains/cards/card-edit.page"
import { reviewModeSchema } from "@cards/shared"

type Search = {
  returnToReviewCard?: boolean
  reviewMode?: "normal" | "free"
}

export const Route = createFileRoute("/(app)/decks/$deckId/cards/$cardId/edit")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const reviewMode = reviewModeSchema.safeParse(search.reviewMode)
    return {
      returnToReviewCard: search.returnToReviewCard === true,
      reviewMode: reviewMode.success ? reviewMode.data : undefined,
    }
  },
  component: CardEditPage,
})
