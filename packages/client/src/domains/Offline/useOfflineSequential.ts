import { useCallback, useEffect, useState } from "react"
import {
  applyReviewLocally,
  sequentialCard,
  type FixationLevel,
  type SequentialMove,
  type SequentialResult,
} from "@cards/shared"
import { applyLocalReviewToSnapshot, enqueueReview, getSnapshot, touchCardInSnapshot } from "./db"
import { SnapshotReviewStore } from "./SnapshotReviewStore"

export interface OfflineSequentialState {
  ready: boolean
  navigating: boolean
  result: SequentialResult | null
  go: (move: SequentialMove, cardId?: string, subjectId?: string) => Promise<void>
  advanceNext: (cardId: string) => Promise<void>
  completeNext: (cardId: string, chosenLevel: FixationLevel) => Promise<void>
  repeatSubject: (cardId: string) => Promise<void>
}

// Offline sequential navigation over the deck snapshot. Navigation is order-based (shared
// sequentialCard), so updated lastSeenAt/cooldown never changes next/prev. Grades and advances are
// applied locally and queued for the server, exactly like the standard offline path.
export function useOfflineSequential(
  deckId: string,
  initialCardId?: string,
  initialSubjectId?: string
): OfflineSequentialState {
  const [result, setResult] = useState<SequentialResult | null>(null)
  const [ready, setReady] = useState(false)
  const [navigating, setNavigating] = useState(false)

  const go = useCallback(
    async (move: SequentialMove, cardId?: string, subjectId?: string) => {
      setNavigating(true)
      try {
        const snapshot = await getSnapshot(deckId)
        if (!snapshot) {
          setResult(null)
          setReady(true)
          return
        }
        const store = new SnapshotReviewStore(snapshot)
        const res = await sequentialCard({
          store,
          userId: "offline",
          deckId,
          cardId,
          subjectId,
          move,
        })
        setResult(res)
        setReady(true)
      } finally {
        setNavigating(false)
      }
    },
    [deckId]
  )

  useEffect(() => {
    if (initialCardId) void go("current", initialCardId)
    else if (initialSubjectId) void go("subjectStart", undefined, initialSubjectId)
    else void go("resume")
  }, [go, initialCardId, initialSubjectId])

  const queueComplete = useCallback(
    async (cardId: string, chosenLevel: FixationLevel) => {
      const snapshot = await getSnapshot(deckId)
      const completedAt = new Date()
      const subject = snapshot?.cards.find((c) => c.id === cardId)?.subjectId
      const subjectRow = subject ? snapshot?.subjects.find((s) => s.id === subject) : undefined
      if (snapshot && subjectRow) {
        const local = applyReviewLocally({
          subject: subjectRow,
          deckStreak: snapshot.deck.inverseReviewStreak,
          chosenLevel,
          now: completedAt,
        })
        await applyLocalReviewToSnapshot(deckId, cardId, local)
      }
      await enqueueReview({ deckId, cardId, chosenLevel, completedAt: completedAt.toISOString() })
    },
    [deckId]
  )

  const advanceNext = useCallback(
    async (cardId: string) => {
      const completedAt = new Date()
      await touchCardInSnapshot(deckId, cardId, completedAt)
      await enqueueReview({ deckId, cardId, advance: true, completedAt: completedAt.toISOString() })
      await go("next", cardId)
    },
    [deckId, go]
  )

  const completeNext = useCallback(
    async (cardId: string, chosenLevel: FixationLevel) => {
      await queueComplete(cardId, chosenLevel)
      await go("next", cardId)
    },
    [queueComplete, go]
  )

  const repeatSubject = useCallback(
    async (cardId: string) => {
      await queueComplete(cardId, "1")
      await go("subjectFirst", cardId)
    },
    [queueComplete, go]
  )

  return { ready, navigating, result, go, advanceNext, completeNext, repeatSubject }
}
