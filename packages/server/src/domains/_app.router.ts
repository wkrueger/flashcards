import { router } from "../infra/trpc.js"
import { ankiImportRouter } from "./anki-import/anki-import.router.js"
import { cardTemplateRouter } from "./card-template/card-template.router.js"
import { cardsRouter } from "./cards/cards.router.js"
import { decksRouter } from "./decks/decks.router.js"
import { languagesRouter } from "./languages/languages.router.js"
import { reviewRouter } from "./review/review.router.js"
import { subjectsRouter } from "./subjects/subjects.router.js"

export const appRouter = router({
  ankiImport: ankiImportRouter,
  cardTemplate: cardTemplateRouter,
  languages: languagesRouter,
  decks: decksRouter,
  subjects: subjectsRouter,
  cards: cardsRouter,
  review: reviewRouter,
})

export type AppRouter = typeof appRouter
