import { createFileRoute } from "@tanstack/react-router"
import { CardEditPage } from "../../domains/cards/card-edit.page"

type Search = {
  returnToReviewCard?: boolean
  reviewMode?: "normal" | "free"
}

export const Route = createFileRoute("/(app)/decks/$deckId/cards/$cardId/edit")({
  validateSearch: (search: Record<string, unknown>): Search => {
    return {
      returnToReviewCard:
        search.returnToReviewCard === true || search.returnToReviewCard === "true",
      reviewMode:
        search.reviewMode === "normal" || search.reviewMode === "free"
          ? search.reviewMode
          : undefined,
    }
  },
  component: CardEditPage,
})
