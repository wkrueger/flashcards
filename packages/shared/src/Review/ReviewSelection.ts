import type { CardRow, ReviewStore, SubjectRow } from "./ReviewStore.js"
import { byDateAsc, byDateDesc, byNumberAsc, byStringAsc, chain } from "./ordering.js"

export const SUBJECT_RANDOM_KEY_RANGE = 2_147_483_647

export function randomSubjectKeyFromRng(rng: () => number): number {
  return Math.floor(rng() * SUBJECT_RANDOM_KEY_RANGE)
}

export const INVERSE_REVIEW_PROBABILITY = 0.2
const LONG_TEXT_TAG = "gen:bigger"
const MEANING_TAG = "gen:meaning"

export interface PickArgs {
  store: ReviewStore
  userId: string
  deckId?: string
  includeOnCooldown: boolean
  excludeCardId?: string
  subjectId?: string
  cardId?: string
  now?: Date
  rng?: () => number
  inverseRng?: () => number
}

export interface PickResult {
  card: CardRow | null
  inverse: boolean
}

// Port of the server's pickNextCard (was reviewService.ts). Selection, ranking, `take`, and
// random picks are done here in pure JS over rows the store returns, so the client and server
// produce identical results given the same data + rng.
export async function pickNextCard(args: PickArgs): Promise<PickResult> {
  const {
    store,
    deckId,
    cardId,
    now = new Date(),
    rng = Math.random,
    inverseRng = Math.random,
  } = args

  const deck = deckId ? await store.getDeckMeta(deckId) : null
  const inverseEnabled = Boolean(deck?.inverseReviewEnabled)
  const inverseReviewStreak = deck?.inverseReviewStreak ?? 0

  if (cardId) {
    const card = await store.getCard(cardId, { deckId })
    if (!card) return { card: null, inverse: false }
    return resolveInverse(store, card, inverseEnabled, inverseReviewStreak, inverseRng)
  }

  return pickFromCandidates({ ...args, now, rng, inverseRng, inverseEnabled, inverseReviewStreak })
}

async function pickFromCandidates(args: {
  store: ReviewStore
  deckId?: string
  includeOnCooldown: boolean
  excludeCardId?: string
  subjectId?: string
  now: Date
  rng: () => number
  inverseRng: () => number
  inverseEnabled: boolean
  inverseReviewStreak: number
  cleanupRetried?: boolean
}): Promise<PickResult> {
  const {
    store,
    deckId,
    includeOnCooldown,
    excludeCardId,
    subjectId,
    now,
    rng,
    inverseRng,
    inverseEnabled,
    inverseReviewStreak,
    cleanupRetried = false,
  } = args

  const pinnedToSubject = Boolean(subjectId)
  const all = await store.listSubjects({ deckId })

  let excludedSubjectId: string | undefined
  if (excludeCardId && !pinnedToSubject) {
    const excluded = await store.getCard(excludeCardId, {})
    if (excluded) excludedSubjectId = excluded.subjectId
  }

  // candidates1: the recents/oldest-due slice.
  const candidates1 = filterAndTake(
    all,
    (s) => {
      if (subjectId) return s.id === subjectId
      if (!includeOnCooldown && s.cooldownAt.getTime() > now.getTime()) return false
      if (s.lastSeenAt === null) return false
      if (excludedSubjectId && s.id === excludedSubjectId) return false
      return true
    },
    includeOnCooldown
      ? byDateAsc<SubjectRow>((s) => s.cooldownAt, "last")
      : chain<SubjectRow>(
          byDateDesc((s) => s.lastSeenShuffle, "last"),
          byDateDesc((s) => s.lastSeenAt, "last")
        ),
    4
  )

  // candidates2: one extra subject sampled by randomKey from outside the recents list.
  let candidates2: SubjectRow[] = []
  if (!pinnedToSubject) {
    const excludeIds = new Set<string>([
      ...(excludedSubjectId ? [excludedSubjectId] : []),
      ...candidates1.map((c) => c.id),
    ])
    const pool = all.filter((s) => {
      if (excludeIds.has(s.id)) return false
      if (!includeOnCooldown && s.cooldownAt.getTime() > now.getTime()) return false
      return true
    })
    const target = randomSubjectKeyFromRng(rng)
    const byKey = chain<SubjectRow>(
      byNumberAsc((s) => s.randomKey, "last"),
      byStringAsc((s) => s.id)
    )
    const gte = pool.filter((s) => s.randomKey >= target).sort(byKey)
    const picked = gte.length > 0 ? gte[0] : pool.filter((s) => s.randomKey < target).sort(byKey)[0]
    if (picked) candidates2 = [picked]
  }

  const candidates = [...candidates1, ...candidates2]
  if (candidates.length === 0) return { card: null, inverse: false }

  const chosen = candidates[Math.floor(rng() * candidates.length)]!

  const cards = await store.listCards({ subjectId: chosen.id, deckId })
  const cardPool =
    pinnedToSubject && excludeCardId ? cards.filter((c) => c.id !== excludeCardId) : cards
  const selectedCard = [...cardPool].sort(
    chain<CardRow>(
      byDateAsc((c) => c.lastSeenAt, "first"),
      byDateAsc((c) => c.createdAt, "last"),
      byStringAsc((c) => c.id)
    )
  )[0]

  if (!selectedCard) {
    if (deckId && !cleanupRetried) {
      await store.deleteEmptySubjects(deckId)
      return pickFromCandidates({ ...args, cleanupRetried: true })
    }
    return { card: null, inverse: false }
  }

  return resolveInverse(store, selectedCard, inverseEnabled, inverseReviewStreak, inverseRng)
}

function filterAndTake(
  rows: SubjectRow[],
  predicate: (s: SubjectRow) => boolean,
  comparator: (a: SubjectRow, b: SubjectRow) => number,
  take: number
): SubjectRow[] {
  return rows.filter(predicate).sort(comparator).slice(0, take)
}

async function resolveInverse(
  store: ReviewStore,
  card: CardRow,
  inverseEnabled: boolean,
  inverseReviewStreak: number,
  inverseRng: () => number
): Promise<PickResult> {
  if (!inverseEnabled) return { card, inverse: false }

  let selected = card
  let inverseProbability: number
  try {
    inverseProbability = inverseReviewProbabilityForCard(card)
  } catch (err) {
    if (!(err instanceof RerollError)) throw err
    // Reroll onto a sibling card in the same subject that isn't a gen:meaning card.
    const siblings = await store.listCards({ subjectId: card.subjectId })
    const fallback = siblings
      .filter((c) => !c.tags.includes(MEANING_TAG))
      .sort(
        chain<CardRow>(
          byDateAsc((c) => c.createdAt, "last"),
          byStringAsc((c) => c.id)
        )
      )[0]
    if (fallback) selected = fallback
    inverseProbability = 0
  }

  inverseProbability = applyInverseStreakPenalty(inverseProbability, inverseReviewStreak)
  const inverse = inverseRng() < inverseProbability
  return { card: selected, inverse }
}

function inverseReviewProbabilityForCard(card: CardRow): number {
  const inverseReviewed = card.subject.inverseReviewed
  const tags = card.tags
  const fixationLevel = card.subject.fixationLevel
  const neverSeen = card.subject.lastSeenAt === null
  if (inverseReviewed) {
    if (tags.includes(MEANING_TAG)) throw new RerollError()
    return 0
  }
  if (tags.includes(LONG_TEXT_TAG)) return 0.7
  if (tags.includes(MEANING_TAG)) return 1
  if (!neverSeen && fixationLevel === "1") return 0.7
  if (!neverSeen && fixationLevel === "2") return 0.4
  return INVERSE_REVIEW_PROBABILITY
}

function applyInverseStreakPenalty(probability: number, inverseReviewStreak: number): number {
  if (probability <= 0) return 0
  if (inverseReviewStreak <= 0) return probability
  return probability / (inverseReviewStreak + 1) ** 2
}

class RerollError extends Error {}
