import { useCallback, useEffect, useRef, useState } from "react"
import {
  applyReviewLocally,
  pickNextCard,
  type CardRow,
  type FixationLevel,
  type ReviewMode,
} from "@cards/shared"
import {
  applyLocalReviewToSnapshot,
  enqueueReview,
  getSnapshot,
  type SnapshotDeck,
  type StoredSnapshot,
} from "./db"
import { SnapshotReviewStore } from "./SnapshotReviewStore"

export interface OfflineReviewState {
  loading: boolean
  ready: boolean
  deck: SnapshotDeck | null
  card: CardRow | null
  inverse: boolean
  completing: boolean
  complete: (choice: { chosenLevel?: FixationLevel; inverse?: boolean }) => Promise<void>
}

// Drives a standard (normal/free/inverse) review session entirely from the IndexedDB snapshot.
// Each pick reads the freshly-persisted snapshot so updated cooldowns are visible to the next card.
export function useOfflineReview(
  deckId: string,
  mode: ReviewMode,
  initialSubjectId?: string,
  initialCardId?: string
): OfflineReviewState {
  const [loading, setLoading] = useState(true)
  const [deck, setDeck] = useState<SnapshotDeck | null>(null)
  const [card, setCard] = useState<CardRow | null>(null)
  const [inverse, setInverse] = useState(false)
  const [completing, setCompleting] = useState(false)
  // First pick honors the deep-linked subject/card; subsequent picks fall back to the queue.
  const pinnedRef = useRef<{ subjectId?: string; cardId?: string }>({
    subjectId: initialSubjectId,
    cardId: initialCardId,
  })

  const pick = useCallback(
    async (excludeCardId?: string) => {
      const snapshot = await getSnapshot(deckId)
      if (!snapshot) {
        setDeck(null)
        setCard(null)
        setLoading(false)
        return
      }
      setDeck(snapshot.deck)
      const store = new SnapshotReviewStore(snapshot)
      const pinned = pinnedRef.current
      const result = await pickNextCard({
        store,
        userId: "offline",
        deckId,
        includeOnCooldown: mode === "free",
        excludeCardId,
        subjectId: pinned.subjectId,
        cardId: pinned.cardId,
      })
      pinnedRef.current = {}
      setCard(result.card)
      setInverse(result.inverse)
      setLoading(false)
    },
    [deckId, mode]
  )

  useEffect(() => {
    setLoading(true)
    pinnedRef.current = { subjectId: initialSubjectId, cardId: initialCardId }
    void pick()
  }, [pick, initialSubjectId, initialCardId])

  const complete = useCallback(
    async (choice: { chosenLevel?: FixationLevel; inverse?: boolean }) => {
      const snapshot: StoredSnapshot | undefined = await getSnapshot(deckId)
      if (!card || !snapshot) return
      setCompleting(true)
      try {
        const subject = snapshot.subjects.find((s) => s.id === card.subjectId)
        const completedAt = new Date()
        if (subject) {
          const result = applyReviewLocally({
            subject,
            deckStreak: snapshot.deck.inverseReviewStreak,
            chosenLevel: choice.chosenLevel,
            inverse: choice.inverse,
            now: completedAt,
          })
          await applyLocalReviewToSnapshot(deckId, card.id, result)
        }
        await enqueueReview({
          deckId,
          cardId: card.id,
          chosenLevel: choice.chosenLevel,
          inverse: choice.inverse,
          completedAt: completedAt.toISOString(),
        })
        await pick(card.id)
      } finally {
        setCompleting(false)
      }
    },
    [card, deckId, pick]
  )

  return { loading, ready: !loading, deck, card, inverse, completing, complete }
}
