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
        subject: { id: string; subject: string; fixationLevel: string }
        tags: string[]
      })
    | null
  dueCount: number
  inverse: boolean
}

export const INVERSE_REVIEW_PROBABILITY = 0.2
const LONG_TEXT_TAG = "gen:bigger"

function inverseReviewProbabilityForCard(fixationLevel: FixationLevel, tags: readonly string[]) {
  if (tags.includes(LONG_TEXT_TAG)) return 0.7
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
  if (deckId) subjectWhere.cards = { some: { deckId } }
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
    ...(includeOnCooldown ? {} : { cooldownAt: { lte: now } }),
    ...(deckId ? { cards: { some: { deckId } } } : {}),
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

  const candidates = [...candidates1, ...candidates2]

  const count = await prisma.subject.count({
    where: subjectWhere,
  })

  const dueCount = includeOnCooldown
    ? await prisma.subject.count({
        where: {
          userId,
          cooldownAt: { lte: now },
          ...(deckId ? { cards: { some: { deckId } } } : {}),
        },
      })
    : count

  if (candidates.length === 0) return { card: null, dueCount, inverse: false }

  const chosen = candidates[Math.floor(rng() * candidates.length)]!

  const card = await prisma.card.findFirst({
    where: {
      subjectId: chosen.id,
      ...(deckId ? { deckId } : {}),
    },
    orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    include: {
      subject: {
        select: { id: true, subject: true, fixationLevel: true },
      },
      cardTags: {
        include: { tag: true },
      },
    },
  })

  if (!card) {
    // Subject exists but no card in scope; recurse without this subject by re-querying
    // (rare race / data shape). Just return null + dueCount.
    return { card: null, dueCount, inverse: false }
  }

  const { cardTags, ...rest } = card
  const tags = cardTags.map((cardTag) => cardTag.tag.name).sort()
  const fixationLevel = fixationLevelSchema.parse(card.subject.fixationLevel)
  const inverseProbability = inverseReviewProbabilityForCard(fixationLevel, tags)
  const inverseRoll = inverseRng()
  console.log({ inverseEnabled, inverseRoll, inverseProbability })
  const inverse = inverseEnabled && inverseRoll < inverseProbability
  return { card: { ...rest, tags } as PickResult["card"], dueCount, inverse }
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
      prisma.subject.update({ where: { id: card.subjectId }, data: { lastSeenAt: now } }),
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
        cooldownAt: cooldown,
      },
    }),
  ])

  return { ok: true, cooldownAt: cooldown }
}
