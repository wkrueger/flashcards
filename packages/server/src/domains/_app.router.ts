import { router } from "../infra/trpc.js"
import { cardTemplateRouter } from "./card-template/card-template.router.js"
import { cardsRouter } from "./cards/cards.router.js"
import { decksRouter } from "./decks/decks.router.js"
import { languagesRouter } from "./languages/languages.router.js"
import { reviewRouter } from "./review/review.router.js"
import { subjectsRouter } from "./subjects/subjects.router.js"

export const appRouter = router({
  cardTemplate: cardTemplateRouter,
  languages: languagesRouter,
  decks: decksRouter,
  subjects: subjectsRouter,
  cards: cardsRouter,
  review: reviewRouter,
})

export type AppRouter = typeof appRouter
