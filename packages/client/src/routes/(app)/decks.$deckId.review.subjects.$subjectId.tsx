import { createFileRoute, useParams } from "@tanstack/react-router"
import { ReviewPage } from "../../domains/Review/ReviewPage"

function SubjectReviewRoute() {
  const { subjectId } = useParams({ from: "/(app)/decks/$deckId/review/subjects/$subjectId" })
  return <ReviewPage mode="normal" initialSubjectId={subjectId} />
}

export const Route = createFileRoute("/(app)/decks/$deckId/review/subjects/$subjectId")({
  component: SubjectReviewRoute,
})
