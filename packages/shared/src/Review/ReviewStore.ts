// Data-provider interface for the shared review selection logic. The server implements it
// over Prisma; the client implements it over an in-memory snapshot loaded from IndexedDB.
// The store only fetches rows for a scope — all ordering, filtering, `take`, and random
// selection live in ReviewSelection.ts / SequentialSelection.ts so both sides decide identically.

export interface SubjectRow {
  id: string
  subject: string
  fixationLevel: string
  inverseReviewed: boolean
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  lastSeenShuffle: Date | null
  cooldownAt: Date
  randomKey: number
  order: number | null
  createdAt: Date
}

export interface CardRow {
  id: string
  deckId: string
  subjectId: string
  front: string
  back: string
  genTemplate: string | null
  order: number | null
  createdAt: Date
  lastSeenAt: Date | null
  tags: string[]
  subject: SubjectRow
}

export interface DeckMeta {
  inverseReviewEnabled: boolean
  inverseReviewStreak: number
}

export interface ReviewStore {
  getDeckMeta(deckId: string): Promise<DeckMeta | null>
  /** All subjects in scope (the adapter always applies userId; deckId narrows further). */
  listSubjects(opts: { deckId?: string }): Promise<SubjectRow[]>
  /** All cards (with tags + embedded subject) for a subject, optionally within a deck. */
  listCards(opts: { subjectId: string; deckId?: string }): Promise<CardRow[]>
  /** All cards in a deck (with tags + embedded subject) — used by sequential navigation. */
  listCardsByDeck(deckId: string): Promise<CardRow[]>
  /** A single card by id (userId-scoped), optionally within a deck. */
  getCard(cardId: string, opts: { deckId?: string }): Promise<CardRow | null>
  /** Server deletes empty subjects then the picker retries; client snapshot is a no-op. */
  deleteEmptySubjects(deckId: string): Promise<void>
}
