import type { PrismaClient } from "../../generated/prisma/client.js"
import {
  COOLDOWN_MS,
  fixationLevelSchema,
  nextCooldownAt,
  pickNextCard as pickNextCardShared,
  type FixationLevel,
} from "@cards/shared"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"
import { pointsFor, recomputeDeckCompletion } from "../Decks/deckCompletionService.js"
import { PrismaReviewStore } from "./PrismaReviewStore.js"

dayjs.extend(utc)

const REVIEW_STATS_RETENTION_DAYS = 15

// Thin wrapper: build the Prisma-backed store and delegate to the shared selection logic
// (packages/shared/src/Review/ReviewSelection.ts), which the offline client runs identically.
export function pickNextCard(args: {
  prisma: PrismaClient
  userId: string
  deckId?: string
  includeOnCooldown: boolean
  excludeCardId?: string
  subjectId?: string
  cardId?: string
  now?: Date
  rng?: () => number
  inverseRng?: () => number
}) {
  const store = new PrismaReviewStore(args.prisma, args.userId)
  return pickNextCardShared({
    store,
    userId: args.userId,
    deckId: args.deckId,
    includeOnCooldown: args.includeOnCooldown,
    excludeCardId: args.excludeCardId,
    subjectId: args.subjectId,
    cardId: args.cardId,
    now: args.now,
    rng: args.rng,
    inverseRng: args.inverseRng,
  })
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
        data: { lastSeenAt: now, lastSeenShuffle: now, inverseReviewed: true },
      }),
      prisma.subject.updateMany({
        where: { id: card.subjectId, firstSeenAt: null },
        data: { firstSeenAt: now },
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
  const previousLevel = card.subject.fixationLevel
  const cooldown = nextCooldownAt(chosenLevel, now)
  const lastSeenShuffle = new Date(now.getTime() + (Math.random() - 0.5) * COOLDOWN_MS[chosenLevel])
  const cardMinutes = Math.round(COOLDOWN_MS[chosenLevel] / 60_000)
  const today = dayjs.utc(now).startOf("day").toDate()
  const retentionCutoff = new Date(
    today.getTime() - REVIEW_STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: card.id },
      data: { lastSeenAt: now, timesSeen: { increment: 1 } },
    })

    await tx.subject.update({
      where: { id: card.subjectId },
      data: {
        lastSeenAt: now,
        lastSeenShuffle,
        timesSeen: { increment: 1 },
        fixationLevel: chosenLevel,
        inverseReviewed: false,
        cooldownAt: cooldown,
      },
    })

    const deckRow = await tx.deck.findUnique({
      where: { id: card.deckId },
      select: { completionScore: true },
    })
    if (deckRow?.completionScore == null) {
      await recomputeDeckCompletion(tx, card.deckId, now)
    } else {
      const delta = pointsFor(chosenLevel) - pointsFor(previousLevel)
      if (delta !== 0) {
        await tx.deck.update({
          where: { id: card.deckId },
          data: { completionScore: { increment: delta } },
        })
      }
    }

    await tx.subject.updateMany({
      where: { id: card.subjectId, firstSeenAt: null },
      data: { firstSeenAt: now },
    })

    await tx.deck.update({
      where: { id: card.deckId },
      data: { inverseReviewStreak: 0 },
    })
  })

  // update stats:
  // 1 row per day. When day changes, create a new row.
  // cardMinutes increases for every card reviewed
  // cardCount increases only for unique cards
  // use a separate table to track already used cards
  // clean up card tracking table on reset
  //
  // does not lock the request (no await), on purpose.

  prisma
    .$transaction(async (tx) => {
      const foundStat = await tx.reviewStat.findFirst({
        where: { deckId: card.deckId, date: today },
        select: { id: true },
      })

      if (foundStat) {
        const cardFound = await tx.reviewStatUniqueCard.findFirst({
          where: { deckId: card.deckId, cardId: card.id },
        })
        await tx.reviewStat.update({
          where: { id: foundStat.id },
          data: {
            cardMinutes: { increment: cardMinutes },
            cardCount: { increment: cardFound ? 0 : 1 },
          },
          select: { id: true },
        })
        if (!cardFound) {
          await tx.reviewStatUniqueCard.create({
            data: {
              cardId: card.id,
              deckId: card.deckId,
              reviewStatId: foundStat.id,
            },
          })
        }
      } else {
        await tx.reviewStatUniqueCard.deleteMany({
          where: { deckId: card.deckId },
        })
        const reviewStat = await tx.reviewStat.create({
          data: {
            deckId: card.deckId,
            date: today,
            cardMinutes,
            cardCount: 1,
          },
          select: { id: true },
        })
        await tx.reviewStatUniqueCard.create({
          data: {
            cardId: card.id,
            deckId: card.deckId,
            reviewStatId: reviewStat.id,
          },
        })
      }

      await tx.reviewStat.deleteMany({
        where: {
          deckId: card.deckId,
          date: { lt: retentionCutoff },
        },
      })
    })
    .catch((err) => {
      console.error("while updating stats", err)
    })

  return { ok: true, cooldownAt: cooldown }
}

export async function advanceCard(
  prisma: PrismaClient,
  userId: string,
  cardId: string,
  now: Date = new Date()
) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    select: { id: true },
  })
  if (!card) throw Object.assign(new Error("Card not found"), { code: "CARD_NOT_FOUND" })
  await prisma.card.update({ where: { id: card.id }, data: { lastSeenAt: now } })
  return { ok: true }
}
