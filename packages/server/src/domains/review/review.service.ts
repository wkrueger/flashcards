import type { PrismaClient } from "../../generated/prisma/client.js"
import { fixationLevelSchema, nextCooldownAt, type FixationLevel } from "@cards/shared"

export interface PickArgs {
  prisma: PrismaClient
  userId: string
  deckId?: string
  includeOnCooldown: boolean
  now?: Date
  rng?: () => number
}

export interface PickResult {
  card:
    | (Awaited<ReturnType<PrismaClient["card"]["findFirst"]>> & {
        subject: { id: string; subject: string; fixationLevel: string }
      })
    | null
  dueCount: number
}

export async function pickNextCard({
  prisma,
  userId,
  deckId,
  includeOnCooldown,
  now = new Date(),
  rng = Math.random,
}: PickArgs): Promise<PickResult> {
  const subjectWhere: any = { userId }
  if (!includeOnCooldown) subjectWhere.cooldownAt = { lte: now }
  if (deckId) subjectWhere.cards = { some: { deckId } }

  const candidates = await prisma.subject.findMany({
    where: subjectWhere,
    orderBy: { cooldownAt: "asc" },
    select: { id: true, cooldownAt: true },
  })

  const dueCount = includeOnCooldown
    ? await prisma.subject.count({
        where: {
          userId,
          cooldownAt: { lte: now },
          ...(deckId ? { cards: { some: { deckId } } } : {}),
        },
      })
    : candidates.length

  if (candidates.length === 0) return { card: null, dueCount }

  const sliceSize = Math.max(1, Math.ceil(candidates.length * 0.3))
  const pool = candidates.slice(0, sliceSize)
  const chosen = pool[Math.floor(rng() * pool.length)]!

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
    },
  })

  if (!card) {
    // Subject exists but no card in scope; recurse without this subject by re-querying
    // (rare race / data shape). Just return null + dueCount.
    return { card: null, dueCount }
  }

  return { card: card as PickResult["card"], dueCount }
}

export async function completeReview(
  prisma: PrismaClient,
  userId: string,
  cardId: string,
  chosenLevel: FixationLevel,
  now: Date = new Date()
) {
  fixationLevelSchema.parse(chosenLevel)

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { subject: true },
  })
  if (!card) throw Object.assign(new Error("Card not found"), { code: "CARD_NOT_FOUND" })

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
