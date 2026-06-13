import type { CardRow, DeckMeta, ReviewStore, SubjectRow } from "@cards/shared"
import type { SnapshotCard, StoredSnapshot } from "./db"

// Client-side ReviewStore over an in-memory deck snapshot. Mirrors PrismaReviewStore: it only
// returns scoped rows; the shared selection logic does all ordering, so offline picks match online.
export class SnapshotReviewStore implements ReviewStore {
  private readonly subjectsById: Map<string, SubjectRow>

  constructor(private readonly snapshot: StoredSnapshot) {
    this.subjectsById = new Map(snapshot.subjects.map((s) => [s.id, s]))
  }

  private toCardRow(card: SnapshotCard): CardRow | null {
    const subject = this.subjectsById.get(card.subjectId)
    if (!subject) return null
    return {
      id: card.id,
      deckId: card.deckId,
      subjectId: card.subjectId,
      front: card.front,
      back: card.back,
      genTemplate: card.genTemplate,
      order: card.order,
      createdAt: card.createdAt,
      lastSeenAt: card.lastSeenAt,
      tags: card.tags,
      subject,
    }
  }

  private mapCards(cards: SnapshotCard[]): CardRow[] {
    return cards.map((c) => this.toCardRow(c)).filter((c): c is CardRow => c !== null)
  }

  async getDeckMeta(deckId: string): Promise<DeckMeta | null> {
    if (deckId !== this.snapshot.deckId) return null
    return {
      inverseReviewEnabled: this.snapshot.deck.inverseReviewEnabled,
      inverseReviewStreak: this.snapshot.deck.inverseReviewStreak,
    }
  }

  async listSubjects(opts: { deckId?: string }): Promise<SubjectRow[]> {
    if (opts.deckId && opts.deckId !== this.snapshot.deckId) return []
    return this.snapshot.subjects
  }

  async listCards(opts: { subjectId: string; deckId?: string }): Promise<CardRow[]> {
    return this.mapCards(
      this.snapshot.cards.filter(
        (c) => c.subjectId === opts.subjectId && (!opts.deckId || c.deckId === opts.deckId)
      )
    )
  }

  async listCardsByDeck(deckId: string): Promise<CardRow[]> {
    if (deckId !== this.snapshot.deckId) return []
    return this.mapCards(this.snapshot.cards)
  }

  async getCard(cardId: string, opts: { deckId?: string }): Promise<CardRow | null> {
    const card = this.snapshot.cards.find(
      (c) => c.id === cardId && (!opts.deckId || c.deckId === opts.deckId)
    )
    return card ? this.toCardRow(card) : null
  }

  async deleteEmptySubjects(): Promise<void> {
    // Snapshots never carry empty subjects worth pruning; the server handles real cleanup.
  }
}
