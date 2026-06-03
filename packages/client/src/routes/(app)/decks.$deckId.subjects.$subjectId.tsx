import { createFileRoute } from "@tanstack/react-router"
import { SubjectCardsPage } from "../../domains/Subjects/SubjectCardsPage"

export const Route = createFileRoute("/(app)/decks/$deckId/subjects/$subjectId")({
  component: SubjectCardsPage,
})
