import { createFileRoute, useParams } from "@tanstack/react-router"
import { ReviewPage } from "../../domains/review/review.page"

function SubjectReviewRoute() {
  const { subjectId } = useParams({ from: "/(app)/decks/$deckId/review/subjects/$subjectId" })
  return <ReviewPage mode="free" subjectId={subjectId} />
}

export const Route = createFileRoute("/(app)/decks/$deckId/review/subjects/$subjectId")({
  component: SubjectReviewRoute,
})
