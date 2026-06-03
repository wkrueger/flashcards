import { router } from "../infra/trpc.js"
import { ankiImportRouter } from "./AnkiImport/ankiImportRouter.js"
import { cardTemplateRouter } from "./CardTemplate/cardTemplateRouter.js"
import { cardsRouter } from "./Cards/cardsRouter.js"
import { deckSpreadsheetRouter } from "./DeckSpreadsheet/deckSpreadsheetRouter.js"
import { decksRouter } from "./Decks/decksRouter.js"
import { languagesRouter } from "./Languages/languagesRouter.js"
import { reviewRouter } from "./Review/reviewRouter.js"
import { subjectsRouter } from "./Subjects/subjectsRouter.js"

export const appRouter = router({
  ankiImport: ankiImportRouter,
  cardTemplate: cardTemplateRouter,
  deckSpreadsheet: deckSpreadsheetRouter,
  languages: languagesRouter,
  decks: decksRouter,
  subjects: subjectsRouter,
  cards: cardsRouter,
  review: reviewRouter,
})

export type AppRouter = typeof appRouter
