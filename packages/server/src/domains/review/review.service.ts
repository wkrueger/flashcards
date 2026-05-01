import type { PrismaClient } from "../../generated/prisma/client.js"
import { Prisma } from "../../generated/prisma/client.js"
import { fixationLevelSchema, nextCooldownAt, type FixationLevel } from "@cards/shared"
import { randomSubjectKeyFromRng } from "../subjects/subjects.service.js"

export interface PickArgs {
  prisma: PrismaClient
  userId: string
  deckId?: string
  includeOnCooldown: boolean
  excludeCardId?: string
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
  dueCount: number
  inverse: boolean
}

export const INVERSE_REVIEW_PROBABILITY = 0.2
const LONG_TEXT_TAG = "gen:bigger"
const MEANING_TAG = "gen:meaning"

type ReviewCard = Prisma.CardGetPayload<{
  include: {
    subject: {
      select: { id: true; subject: true; fixationLevel: true; inverseReviewed: true }
    }
    cardTags: { include: { tag: true } }
  }
}>

class RerollError extends Error {}

function inverseReviewProbabilityForCard(card: ReviewCard) {
  const inverseReviewed = card.subject.inverseReviewed
  const tags = card.cardTags.map((x) => x.tag.name)
  const fixationLevel = card.subject.fixationLevel
  if (inverseReviewed) {
    if (tags.includes(MEANING_TAG)) throw new RerollError()
    return 0
  }
  if (tags.includes(LONG_TEXT_TAG)) return 0.7
  if (tags.includes(MEANING_TAG)) return 1
  if (fixationLevel === "1") return 0.7
  if (fixationLevel === "2") return 0.4
  return INVERSE_REVIEW_PROBABILITY
}

export async function pickNextCard({
  prisma,
  userId,
  deckId,
  includeOnCooldown,
  excludeCardId,
  now = new Date(),
  rng = Math.random,
  inverseRng = Math.random,
}: PickArgs): Promise<PickResult> {
  const inverseEnabled = deckId
    ? Boolean(
        (
          await prisma.deck.findFirst({
            where: { id: deckId, userId },
            select: { inverseReviewEnabled: true },
          })
        )?.inverseReviewEnabled
      )
    : false

  const subjectWhere: Prisma.SubjectWhereInput = { userId }
  if (!includeOnCooldown) subjectWhere.cooldownAt = { lte: now }
  if (deckId) subjectWhere.deckId = deckId
  let excludedSubjectId: string | undefined
  if (excludeCardId) {
    const excluded = await prisma.card.findFirst({
      where: { id: excludeCardId, deck: { userId } },
      select: { subjectId: true },
    })
    if (excluded) {
      excludedSubjectId = excluded.subjectId
      subjectWhere.id = { not: excludedSubjectId }
    }
  }

  const candidates1 = await prisma.subject.findMany({
    where: subjectWhere,
    orderBy: includeOnCooldown ? { cooldownAt: "asc" } : { lastSeenAt: "desc" },
    select: { id: true, cooldownAt: true, randomKey: true },
    take: 4,
  })

  // Include some candidates from outside the recents list.
  const candidate2Where: Prisma.SubjectWhereInput = {
    userId,
    ...(deckId ? { deckId } : {}),
    ...(includeOnCooldown ? {} : { cooldownAt: { lte: now } }),
    ...(excludedSubjectId ? { id: { not: excludedSubjectId } } : {}),
    ...(candidates1.length > 0
      ? { id: { notIn: candidates1.map((candidate) => candidate.id) } }
      : {}),
  }

  const candidate2Target = randomSubjectKeyFromRng(rng)
  const candidate2OrderBy: Prisma.SubjectOrderByWithRelationInput[] = [
    { randomKey: "asc" },
    { id: "asc" },
  ]
  let candidates2 = await prisma.subject.findMany({
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

  const candidates = [...candidates1, ...candidates1, ...candidates2]

  const count = await prisma.subject.count({
    where: subjectWhere,
  })

  const dueCount = includeOnCooldown
    ? await prisma.subject.count({
        where: {
          userId,
          ...(deckId ? { deckId } : {}),
          cooldownAt: { lte: now },
        },
      })
    : count

  if (candidates.length === 0) return { card: null, dueCount, inverse: false }

  const chosen = candidates[Math.floor(rng() * candidates.length)]!

  let selectedCard = await prisma.card.findFirst({
    where: {
      subjectId: chosen.id,
      ...(deckId ? { deckId } : {}),
    },
    orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    include: {
      subject: {
        select: { id: true, subject: true, fixationLevel: true, inverseReviewed: true },
      },
      cardTags: {
        include: { tag: true },
      },
    },
  })

  if (!selectedCard) {
    // Subject exists but no card in scope; recurse without this subject by re-querying
    // (rare race / data shape). Just return null + dueCount.
    return { card: null, dueCount, inverse: false }
  }

  let isInverse = false
  if (inverseEnabled) {
    const { isInverse: isInverseResp, cardFallback } = await getIsInverse(
      prisma,
      selectedCard,
      inverseRng
    )
    isInverse = isInverseResp
    if (cardFallback) {
      selectedCard = cardFallback
    }
  }
  const { cardTags, ...rest } = selectedCard
  const tags = cardTags.map((cardTag) => cardTag.tag.name).sort()
  return { card: { ...rest, tags } as PickResult["card"], dueCount, inverse: isInverse }
}

async function getIsInverse(prisma: PrismaClient, card: ReviewCard, inverseRng: () => number) {
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
            select: { id: true, subject: true, fixationLevel: true, inverseReviewed: true },
          },
          cardTags: {
            include: { tag: true },
          },
        },
      })
      if (!cardFallback) {
        inverseProbability = 0
      } else {
        const fallbackFixationLevel = fixationLevelSchema.parse(cardFallback.subject.fixationLevel)
        const fallbackTags = cardFallback.cardTags.map((cardTag) => cardTag.tag.name).sort()
        inverseProbability = inverseReviewProbabilityForCard(cardFallback)
      }
    } else {
      throw err
    }
  }
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
    ])
    return { ok: true, cooldownAt: card.subject.cooldownAt }
  }

  if (!options.chosenLevel) {
    throw Object.assign(new Error("chosenLevel required"), { code: "BAD_INPUT" })
  }
  const chosenLevel = fixationLevelSchema.parse(options.chosenLevel)
  const cooldown = nextCooldownAt(chosenLevel, now)

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
  ])

  return { ok: true, cooldownAt: cooldown }
}
