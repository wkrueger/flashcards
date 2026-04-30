import { createFileRoute } from "@tanstack/react-router"
import { SubjectCardsPage } from "../../domains/subjects/subject-cards.page"

export const Route = createFileRoute("/(app)/decks/$deckId/subjects/$subjectId")({
  component: SubjectCardsPage,
})
