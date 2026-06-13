import { COMPLETION_POINTS, COOLDOWN_MS, type FixationLevel, nextCooldownAt } from "../Fixation.js"
import type { SubjectRow } from "./ReviewStore.js"

export interface LocalReviewResult {
  /** New subject state to write back into the snapshot (selection-relevant fields). */
  subject: SubjectRow
  /** New `lastSeenAt` for the reviewed card. */
  cardLastSeenAt: Date
  /** New deck inverse-review streak (affects offline inverse probability). */
  deckStreak: number
  /** Change in deck completion score, for optional local display. */
  completionDelta: number
}

// Pure port of completeReview (reviewService.ts) minus the DB writes and async stats. The client
// applies this to its IndexedDB snapshot so the next offline pick sees the updated cooldown, and
// queues the raw review for the server to replay authoritatively on sync.
export function applyReviewLocally(args: {
  subject: SubjectRow
  deckStreak: number
  chosenLevel?: FixationLevel
  inverse?: boolean
  now?: Date
  shuffleRng?: () => number
}): LocalReviewResult {
  const {
    subject,
    deckStreak,
    chosenLevel,
    inverse,
    now = new Date(),
    shuffleRng = Math.random,
  } = args
  const firstSeenAt = subject.firstSeenAt ?? now

  if (inverse) {
    return {
      subject: {
        ...subject,
        lastSeenAt: now,
        lastSeenShuffle: now,
        inverseReviewed: true,
        firstSeenAt,
      },
      cardLastSeenAt: now,
      deckStreak: deckStreak + 1,
      completionDelta: 0,
    }
  }

  if (!chosenLevel) throw new Error("chosenLevel is required when not in inverse mode")

  const cooldownAt = nextCooldownAt(chosenLevel, now)
  const lastSeenShuffle = new Date(now.getTime() + (shuffleRng() - 0.5) * COOLDOWN_MS[chosenLevel])
  const completionDelta =
    (COMPLETION_POINTS[chosenLevel] ?? 0) -
    (COMPLETION_POINTS[subject.fixationLevel as FixationLevel] ?? 0)

  return {
    subject: {
      ...subject,
      lastSeenAt: now,
      lastSeenShuffle,
      fixationLevel: chosenLevel,
      inverseReviewed: false,
      cooldownAt,
      firstSeenAt,
    },
    cardLastSeenAt: now,
    deckStreak: 0,
    completionDelta,
  }
}
