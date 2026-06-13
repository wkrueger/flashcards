import type { SequentialMove } from "../Schemas.js"
import type { CardRow, ReviewStore, SubjectRow } from "./ReviewStore.js"
import { byDateAsc, byDateDesc, byNumberAsc, byStringAsc, byStringDesc, chain } from "./ordering.js"

export interface SequentialResult {
  card: {
    id: string
    deckId: string
    subjectId: string
    front: string
    back: string
    genTemplate: string | null
    tags: string[]
    subject: {
      id: string
      subject: string
      fixationLevel: string
      firstSeenAt: Date | null
      lastSeenAt: Date | null
    }
  } | null
  isLastInSubject: boolean
  hasPrev: boolean
  atEnd: boolean
}

// `order` (nulls last) then `createdAt` then `id` gives a total order for both subjects and
// cards — the same total order the server's cursor queries (reviewSequential.ts) walked.
const subjectCmp = chain<SubjectRow>(
  byNumberAsc((s) => s.order, "last"),
  byDateAsc((s) => s.createdAt, "last"),
  byStringAsc((s) => s.id)
)
const cardCmp = chain<CardRow>(
  byNumberAsc((c) => c.order, "last"),
  byDateAsc((c) => c.createdAt, "last"),
  byStringAsc((c) => c.id)
)

export async function sequentialCard(args: {
  store: ReviewStore
  userId: string
  deckId: string
  cardId?: string
  subjectId?: string
  move: SequentialMove
}): Promise<SequentialResult> {
  const { store, deckId, cardId, subjectId, move } = args

  const deck = await store.getDeckMeta(deckId)
  if (!deck) throw Object.assign(new Error("Deck not found"), { code: "DECK_NOT_FOUND" })

  const subjects = (await store.listSubjects({ deckId })).sort(subjectCmp)
  const deckCards = await store.listCardsByDeck(deckId)
  const bySubject = new Map<string, CardRow[]>()
  for (const c of deckCards) {
    const arr = bySubject.get(c.subjectId) ?? []
    arr.push(c)
    bySubject.set(c.subjectId, arr)
  }
  for (const arr of bySubject.values()) arr.sort(cardCmp)

  const cardsOf = (sid: string): CardRow[] => bySubject.get(sid) ?? []
  const edgeCard = (sid: string, edge: "first" | "last"): string | null => {
    const arr = cardsOf(sid)
    if (arr.length === 0) return null
    return (edge === "first" ? arr[0] : arr[arr.length - 1])!.id
  }
  const firstCardId = (): string | null => (subjects[0] ? edgeCard(subjects[0].id, "first") : null)
  const adjacentSubject = (sid: string, dir: "next" | "prev"): SubjectRow | null => {
    const idx = subjects.findIndex((s) => s.id === sid)
    if (idx === -1) return null
    return subjects[dir === "next" ? idx + 1 : idx - 1] ?? null
  }

  let targetId: string | null
  if (move === "first") {
    targetId = firstCardId()
  } else if (move === "resume") {
    const seen = deckCards
      .filter((c) => c.lastSeenAt !== null)
      .sort(
        chain(
          byDateDesc<CardRow>((c) => c.lastSeenAt, "last"),
          byStringDesc((c) => c.id)
        )
      )
    targetId = seen[0]?.id ?? firstCardId()
  } else if (move === "current") {
    targetId = cardId ?? firstCardId()
  } else if (move === "subjectStart") {
    targetId = subjectId
      ? subjects.some((s) => s.id === subjectId)
        ? edgeCard(subjectId, "first")
        : null
      : firstCardId()
  } else if (move === "subjectFirst") {
    const current = cardId ? deckCards.find((c) => c.id === cardId) : null
    targetId = current ? edgeCard(current.subjectId, "first") : firstCardId()
  } else if (cardId && (move === "next" || move === "prev")) {
    targetId = neighborCardId(cardId, move, deckCards, cardsOf, edgeCard, adjacentSubject)
  } else {
    targetId = firstCardId()
  }

  if (!targetId) {
    return { card: null, isLastInSubject: false, hasPrev: false, atEnd: move === "next" }
  }

  const card = deckCards.find((c) => c.id === targetId)
  if (!card) return { card: null, isLastInSubject: false, hasPrev: false, atEnd: false }

  const sibs = cardsOf(card.subjectId)
  const idx = sibs.findIndex((c) => c.id === card.id)
  const isLastInSubject = idx === sibs.length - 1
  const isFirstInSubject = idx === 0
  const hasPrev = isFirstInSubject ? adjacentSubject(card.subjectId, "prev") !== null : true

  return {
    card: {
      id: card.id,
      deckId: card.deckId,
      subjectId: card.subjectId,
      front: card.front,
      back: card.back,
      genTemplate: card.genTemplate,
      tags: card.tags,
      subject: {
        id: card.subject.id,
        subject: card.subject.subject,
        fixationLevel: card.subject.fixationLevel,
        firstSeenAt: card.subject.firstSeenAt,
        lastSeenAt: card.subject.lastSeenAt,
      },
    },
    isLastInSubject,
    hasPrev,
    atEnd: false,
  }
}

function neighborCardId(
  cardId: string,
  dir: "next" | "prev",
  deckCards: CardRow[],
  cardsOf: (sid: string) => CardRow[],
  edgeCard: (sid: string, edge: "first" | "last") => string | null,
  adjacentSubject: (sid: string, dir: "next" | "prev") => SubjectRow | null
): string | null {
  const current = deckCards.find((c) => c.id === cardId)
  if (!current) return null
  const sibs = cardsOf(current.subjectId)
  const idx = sibs.findIndex((c) => c.id === cardId)

  if (dir === "next") {
    if (idx >= 0 && idx < sibs.length - 1) return sibs[idx + 1]!.id
    const next = adjacentSubject(current.subjectId, "next")
    return next ? edgeCard(next.id, "first") : null
  }
  if (idx > 0) return sibs[idx - 1]!.id
  const prev = adjacentSubject(current.subjectId, "prev")
  return prev ? edgeCard(prev.id, "last") : null
}
