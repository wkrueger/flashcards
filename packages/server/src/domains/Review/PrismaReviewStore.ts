import type { CardRow, DeckMeta, ReviewStore, SubjectRow } from "@cards/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { deleteEmptySubjectsForDeck } from "../Subjects/subjectsService.js"

const subjectSelect = {
  id: true,
  subject: true,
  fixationLevel: true,
  inverseReviewed: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastSeenShuffle: true,
  cooldownAt: true,
  randomKey: true,
  order: true,
  createdAt: true,
} satisfies Prisma.SubjectSelect

const cardInclude = {
  subject: { select: subjectSelect },
  cardTags: { include: { tag: true } },
} satisfies Prisma.CardInclude

type CardWithRelations = Prisma.CardGetPayload<{ include: typeof cardInclude }>

function toCardRow(card: CardWithRelations): CardRow {
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
    tags: card.cardTags.map((ct) => ct.tag.name).sort(),
    subject: card.subject as SubjectRow,
  }
}

// Prisma-backed implementation of the shared ReviewStore. It only fetches scoped rows; all
// ordering/selection lives in the shared review logic so the server and client agree.
export class PrismaReviewStore implements ReviewStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly userId: string
  ) {}

  async getDeckMeta(deckId: string): Promise<DeckMeta | null> {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, userId: this.userId },
      select: { inverseReviewEnabled: true, inverseReviewStreak: true },
    })
    return deck
  }

  async listSubjects(opts: { deckId?: string }): Promise<SubjectRow[]> {
    const subjects = await this.prisma.subject.findMany({
      where: { userId: this.userId, ...(opts.deckId ? { deckId: opts.deckId } : {}) },
      select: subjectSelect,
    })
    return subjects
  }

  async listCards(opts: { subjectId: string; deckId?: string }): Promise<CardRow[]> {
    const cards = await this.prisma.card.findMany({
      where: {
        subjectId: opts.subjectId,
        deck: { userId: this.userId },
        ...(opts.deckId ? { deckId: opts.deckId } : {}),
      },
      include: cardInclude,
    })
    return cards.map(toCardRow)
  }

  async listCardsByDeck(deckId: string): Promise<CardRow[]> {
    const cards = await this.prisma.card.findMany({
      where: { deckId, deck: { userId: this.userId } },
      include: cardInclude,
    })
    return cards.map(toCardRow)
  }

  async getCard(cardId: string, opts: { deckId?: string }): Promise<CardRow | null> {
    const card = await this.prisma.card.findFirst({
      where: {
        id: cardId,
        deck: { userId: this.userId },
        ...(opts.deckId ? { deckId: opts.deckId } : {}),
      },
      include: cardInclude,
    })
    return card ? toCardRow(card) : null
  }

  async deleteEmptySubjects(deckId: string): Promise<void> {
    await deleteEmptySubjectsForDeck(this.prisma, this.userId, deckId)
  }
}
