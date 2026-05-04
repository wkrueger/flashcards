import type { PrismaClient } from "../../generated/prisma/client.js"
import { Prisma } from "../../generated/prisma/client.js"
import { COOLDOWN_MS, fixationLevelSchema, nextCooldownAt, type FixationLevel } from "@cards/shared"
import { randomSubjectKeyFromRng } from "../subjects/subjects.service.js"

const REVIEW_STATS_RETENTION_DAYS = 15

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export interface PickArgs {
  prisma: PrismaClient
  userId: string
  deckId?: string
  includeOnCooldown: boolean
  excludeCardId?: string
  subjectId?: string
  now?: Date
  rng?: () => number
  inverseRng?: () => number
}

export interface PickResult {
  card:
    | (Awaited<ReturnType<PrismaClient["card"]["findFirst"]>> & {
        subject: {
          id: string
          subject: string
          fixationLevel: string
          inverseReviewed: boolean
        }
        tags: string[]
      })
    | null
  inverse: boolean
}

export const INVERSE_REVIEW_PROBABILITY = 0.2
const LONG_TEXT_TAG = "gen:bigger"
const MEANING_TAG = "gen:meaning"

type ReviewCard = Prisma.CardGetPayload<{
  include: {
    subject: {
      select: {
        id: true
        subject: true
        fixationLevel: true
        inverseReviewed: true
        lastSeenAt: true
      }
    }
    cardTags: { include: { tag: true } }
  }
}>

class RerollError extends Error {}

function inverseReviewProbabilityForCard(card: ReviewCard) {
  const inverseReviewed = card.subject.inverseReviewed
  const tags = card.cardTags.map((x) => x.tag.name)
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

function applyInverseStreakPenalty(probability: number, inverseReviewStreak: number) {
  if (probability <= 0) return 0
  if (inverseReviewStreak <= 0) return probability
  return probability / (inverseReviewStreak + 1) ** 2
}

export async function pickNextCard({
  prisma,
  userId,
  deckId,
  includeOnCooldown,
  excludeCardId,
  subjectId,
  now = new Date(),
  rng = Math.random,
  inverseRng = Math.random,
}: PickArgs): Promise<PickResult> {
  const deck = deckId
    ? await prisma.deck.findFirst({
        where: { id: deckId, userId },
        select: { inverseReviewEnabled: true, inverseReviewStreak: true },
      })
    : null
  const inverseEnabled = Boolean(deck?.inverseReviewEnabled)
  const inverseReviewStreak = deck?.inverseReviewStreak ?? 0

  const pinnedToSubject = Boolean(subjectId)
  const subjectWhere: Prisma.SubjectWhereInput = { userId }
  if (!includeOnCooldown && !pinnedToSubject) subjectWhere.cooldownAt = { lte: now }
  if (deckId) subjectWhere.deckId = deckId
  if (subjectId) subjectWhere.id = subjectId
  let excludedSubjectId: string | undefined
  if (excludeCardId && !pinnedToSubject) {
    const excluded = await prisma.card.findFirst({
      where: { id: excludeCardId, deck: { userId } },
      select: { subjectId: true },
    })
    if (excluded) {
      excludedSubjectId = excluded.subjectId
      subjectWhere.id = { not: excludedSubjectId }
    }
  }
  if (!subjectId) {
    subjectWhere.lastSeenAt = { not: null }
  }

  const candidates1 = await prisma.subject.findMany({
    where: subjectWhere,
    orderBy: includeOnCooldown ? { cooldownAt: "asc" } : { lastSeenAt: "desc" },
    select: { id: true, cooldownAt: true, randomKey: true },
    take: 4,
  })

  let candidates2: { id: string; cooldownAt: Date; randomKey: number }[] = []
  if (!pinnedToSubject) {
    // Include some candidates from outside the recents list.
    const excludeIds = [
      ...(excludedSubjectId ? [excludedSubjectId] : []),
      ...candidates1.map((c) => c.id),
    ]
    const candidate2Where: Prisma.SubjectWhereInput = {
      userId,
      ...(deckId ? { deckId } : {}),
      ...(includeOnCooldown ? {} : { cooldownAt: { lte: now } }),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    }

    const candidate2Target = randomSubjectKeyFromRng(rng)
    const candidate2OrderBy: Prisma.SubjectOrderByWithRelationInput[] = [
      { randomKey: "asc" },
      { id: "asc" },
    ]
    candidates2 = await prisma.subject.findMany({
      where: {
        ...candidate2Where,
        randomKey: { gte: candidate2Target },
      },
      orderBy: candidate2OrderBy,
      select: { id: true, cooldownAt: true, randomKey: true },
      take: 1,
    })

    if (candidates2.length === 0) {
      candidates2 = await prisma.subject.findMany({
        where: {
          ...candidate2Where,
          randomKey: { lt: candidate2Target },
        },
        orderBy: candidate2OrderBy,
        select: { id: true, cooldownAt: true, randomKey: true },
        take: 1,
      })
    }
  }

  const candidates = [...candidates1, ...candidates1, ...candidates2]

  if (candidates.length === 0) return { card: null, inverse: false }

  const chosen = candidates[Math.floor(rng() * candidates.length)]!

  let selectedCard = await prisma.card.findFirst({
    where: {
      subjectId: chosen.id,
      ...(deckId ? { deckId } : {}),
      ...(pinnedToSubject && excludeCardId ? { id: { not: excludeCardId } } : {}),
    },
    orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    include: {
      subject: {
        select: {
          id: true,
          subject: true,
          fixationLevel: true,
          inverseReviewed: true,
          lastSeenAt: true,
        },
      },
      cardTags: {
        include: { tag: true },
      },
    },
  })

  if (!selectedCard) {
    return { card: null, inverse: false }
  }

  let isInverse = false
  if (inverseEnabled) {
    const { isInverse: isInverseResp, cardFallback } = await getIsInverse(
      prisma,
      selectedCard,
      inverseReviewStreak,
      inverseRng
    )
    isInverse = isInverseResp
    if (cardFallback) {
      selectedCard = cardFallback
    }
  }
  const { cardTags, ...rest } = selectedCard
  const tags = cardTags.map((cardTag) => cardTag.tag.name).sort()
  return { card: { ...rest, tags } as PickResult["card"], inverse: isInverse }
}

async function getIsInverse(
  prisma: PrismaClient,
  card: ReviewCard,
  inverseReviewStreak: number,
  inverseRng: () => number
) {
  let cardFallback: ReviewCard | null = null
  let inverseProbability: number
  try {
    inverseProbability = inverseReviewProbabilityForCard(card)
  } catch (err) {
    if (err instanceof RerollError) {
      cardFallback = await prisma.card.findFirst({
        where: {
          subjectId: card.subject.id,
          cardTags: {
            none: { tag: { name: "gen:meaning" } },
          },
        },
        include: {
          subject: {
            select: {
              id: true,
              subject: true,
              fixationLevel: true,
              inverseReviewed: true,
              lastSeenAt: true,
            },
          },
          cardTags: {
            include: { tag: true },
          },
        },
      })
      inverseProbability = 0
    } else {
      throw err
    }
  }
  inverseProbability = applyInverseStreakPenalty(inverseProbability, inverseReviewStreak)
  const inverseRoll = inverseRng()
  return { isInverse: inverseRoll < inverseProbability, cardFallback }
}

export async function completeReview(
  prisma: PrismaClient,
  userId: string,
  cardId: string,
  options: { chosenLevel?: FixationLevel; inverse?: boolean },
  now: Date = new Date()
) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { subject: true },
  })
  if (!card) throw Object.assign(new Error("Card not found"), { code: "CARD_NOT_FOUND" })

  if (options.inverse) {
    await prisma.$transaction([
      prisma.card.update({ where: { id: card.id }, data: { lastSeenAt: now } }),
      prisma.subject.update({
        where: { id: card.subjectId },
        data: { lastSeenAt: now, inverseReviewed: true },
      }),
      prisma.deck.update({
        where: { id: card.deckId },
        data: { inverseReviewStreak: { increment: 1 } },
      }),
    ])
    return { ok: true, cooldownAt: card.subject.cooldownAt }
  }

  if (!options.chosenLevel) {
    throw Object.assign(new Error("chosenLevel required"), { code: "BAD_INPUT" })
  }
  const chosenLevel = fixationLevelSchema.parse(options.chosenLevel)
  const cooldown = nextCooldownAt(chosenLevel, now)
  const cardMinutes = Math.round(COOLDOWN_MS[chosenLevel] / 60_000)
  const today = startOfUtcDay(now)
  const retentionCutoff = new Date(
    today.getTime() - REVIEW_STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )

  await prisma.$transaction([
    prisma.card.update({
      where: { id: card.id },
      data: { lastSeenAt: now, timesSeen: { increment: 1 } },
    }),
    prisma.subject.update({
      where: { id: card.subjectId },
      data: {
        lastSeenAt: now,
        timesSeen: { increment: 1 },
        fixationLevel: chosenLevel,
        inverseReviewed: false,
        cooldownAt: cooldown,
      },
    }),
    prisma.deck.update({
      where: { id: card.deckId },
      data: { inverseReviewStreak: 0 },
    }),
    prisma.reviewStat.upsert({
      where: { deckId_date: { deckId: card.deckId, date: today } },
      create: { deckId: card.deckId, date: today, cardMinutes, cardCount: 1 },
      update: { cardMinutes: { increment: cardMinutes }, cardCount: { increment: 1 } },
    }),
    prisma.reviewStat.deleteMany({
      where: { deckId: card.deckId, date: { lt: retentionCutoff } },
    }),
  ])

  return { ok: true, cooldownAt: cooldown }
}
