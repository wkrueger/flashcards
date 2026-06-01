import { TRPCError } from "@trpc/server"
import { createDeckInput, idInput, updateDeckInput } from "@cards/shared"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { randomSubjectKey } from "../subjects/subjects.service.js"
import {
  COMPLETION_STALE_MS,
  completionPercent,
  recomputeDeckCompletion,
} from "./deck-completion.service.js"

dayjs.extend(utc)

const DAY_MS = 24 * 60 * 60 * 1000
const SAMPLE_SUBJECT_LIMIT = 8
const REVIEW_STATS_WINDOW_DAYS = 7

async function assertLanguagesExist(
  prisma: { language: { count: (args: { where: { id: { in: number[] } } }) => Promise<number> } },
  ids: number[]
) {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return
  const found = await prisma.language.count({ where: { id: { in: unique } } })
  if (found !== unique.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Language not found." })
  }
}

export const decksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.user.id },
      orderBy: { name: "asc" },
    })
    const dueCounts = await Promise.all(
      decks.map((d) =>
        ctx.prisma.subject.count({
          where: {
            userId: ctx.user.id,
            deckId: d.id,
            cooldownAt: { lte: now },
          },
        })
      )
    )
    return decks.map((d, i) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      dueCount: dueCounts[i] ?? 0,
    }))
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const now = new Date()
    const [deck, cardCount, wordCount, cooldownCount, seenSubjectCount, unseenSubjectCount] =
      await Promise.all([
        ctx.prisma.deck.findFirst({
          where: { id: input.id, userId: ctx.user.id },
          include: {
            defaultBackLanguage: {
              select: { speechRecognitionLocale: true },
            },
          },
        }),
        ctx.prisma.card.count({ where: { deckId: input.id } }),
        ctx.prisma.subject.count({
          where: { deckId: input.id, userId: ctx.user.id },
        }),
        ctx.prisma.subject.count({
          where: {
            userId: ctx.user.id,
            deckId: input.id,
            cooldownAt: { gt: now },
          },
        }),
        ctx.prisma.subject.count({
          where: { deckId: input.id, userId: ctx.user.id, firstSeenAt: { not: null } },
        }),
        ctx.prisma.subject.count({
          where: { deckId: input.id, userId: ctx.user.id, firstSeenAt: null },
        }),
      ])
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    let completionScore = deck.completionScore
    const stale =
      completionScore == null ||
      deck.completionComputedAt == null ||
      now.getTime() - deck.completionComputedAt.getTime() > COMPLETION_STALE_MS
    if (stale) {
      completionScore = await recomputeDeckCompletion(ctx.prisma, deck.id, now)
    }
    return {
      id: deck.id,
      name: deck.name,
      createdAt: deck.createdAt,
      defaultFrontLanguageId: deck.defaultFrontLanguageId,
      defaultBackLanguageId: deck.defaultBackLanguageId,
      speechRecognitionLocale: deck.defaultBackLanguage?.speechRecognitionLocale ?? null,
      speechRecognitionEnabled: deck.speechRecognitionEnabled,
      inverseReviewEnabled: deck.inverseReviewEnabled,
      cardCount,
      wordCount,
      completionPercent: completionPercent(completionScore, wordCount),
      cooldownCount,
      seenSubjectCount,
      unseenSubjectCount,
    }
  }),

  create: protectedProcedure.input(createDeckInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.deck.findFirst({
      where: { userId: ctx.user.id, name: input.name },
    })
    if (existing)
      throw new TRPCError({
        code: "CONFLICT",
        message: "A deck with that name already exists.",
      })
    const langIds = [input.defaultFrontLanguageId, input.defaultBackLanguageId].filter(
      (v): v is number => typeof v === "number"
    )
    await assertLanguagesExist(ctx.prisma, langIds)
    return ctx.prisma.deck.create({
      data: {
        name: input.name,
        userId: ctx.user.id,
        defaultFrontLanguageId: input.defaultFrontLanguageId ?? null,
        defaultBackLanguageId: input.defaultBackLanguageId ?? null,
        speechRecognitionEnabled: input.speechRecognitionEnabled ?? true,
        inverseReviewEnabled: input.inverseReviewEnabled ?? false,
      },
    })
  }),

  update: protectedProcedure.input(updateDeckInput).mutation(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    if (input.name !== undefined && input.name !== deck.name) {
      const conflict = await ctx.prisma.deck.findFirst({
        where: { userId: ctx.user.id, name: input.name, NOT: { id: deck.id } },
      })
      if (conflict)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A deck with that name already exists.",
        })
    }
    const langIds = [input.defaultFrontLanguageId, input.defaultBackLanguageId].filter(
      (v): v is number => typeof v === "number"
    )
    await assertLanguagesExist(ctx.prisma, langIds)
    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.defaultFrontLanguageId !== undefined)
      data.defaultFrontLanguageId = input.defaultFrontLanguageId ?? null
    if (input.defaultBackLanguageId !== undefined)
      data.defaultBackLanguageId = input.defaultBackLanguageId ?? null
    if (input.speechRecognitionEnabled !== undefined)
      data.speechRecognitionEnabled = input.speechRecognitionEnabled
    if (input.inverseReviewEnabled !== undefined)
      data.inverseReviewEnabled = input.inverseReviewEnabled
    return ctx.prisma.deck.update({
      where: { id: deck.id },
      data,
    })
  }),

  upcomingDueCounts: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    const now = new Date()
    const at = (days: number) => new Date(now.getTime() + days * DAY_MS)
    const baseWhere = {
      userId: ctx.user.id,
      deckId: input.id,
    } as const
    const [in24h, in2d, in1w] = await Promise.all([
      ctx.prisma.subject.count({ where: { ...baseWhere, cooldownAt: { lte: at(1) } } }),
      ctx.prisma.subject.count({ where: { ...baseWhere, cooldownAt: { lte: at(2) } } }),
      ctx.prisma.subject.count({ where: { ...baseWhere, cooldownAt: { lte: at(7) } } }),
    ])
    return { in24h, in2d, in1w }
  }),

  randomSubjects: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    const where = {
      userId: ctx.user.id,
      deckId: input.id,
    } as const
    const pivot = randomSubjectKey()
    const first = await ctx.prisma.subject.findMany({
      where: { ...where, randomKey: { gte: pivot } },
      orderBy: { randomKey: "asc" },
      take: SAMPLE_SUBJECT_LIMIT,
      select: { id: true, subject: true },
    })
    if (first.length >= SAMPLE_SUBJECT_LIMIT) return first
    const second = await ctx.prisma.subject.findMany({
      where: { ...where, randomKey: { lt: pivot } },
      orderBy: { randomKey: "asc" },
      take: SAMPLE_SUBJECT_LIMIT - first.length,
      select: { id: true, subject: true },
    })
    return [...first, ...second]
  }),

  reviewStats: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    const today = dayjs.utc().startOf("day").toDate()
    const earliest = new Date(today.getTime() - (REVIEW_STATS_WINDOW_DAYS - 1) * DAY_MS)
    const rows = await ctx.prisma.reviewStat.findMany({
      where: { deckId: input.id, date: { gte: earliest } },
      orderBy: { date: "asc" },
      select: { date: true, cardMinutes: true, cardCount: true },
    })
    const byTime = new Map(
      rows.map((r) => [r.date.getTime(), { cardMinutes: r.cardMinutes, cardCount: r.cardCount }])
    )
    return Array.from({ length: REVIEW_STATS_WINDOW_DAYS }, (_, i) => {
      const date = new Date(earliest.getTime() + i * DAY_MS)
      const entry = byTime.get(date.getTime())
      return {
        date,
        cardMinutes: entry?.cardMinutes ?? 0,
        cardCount: entry?.cardCount ?? 0,
      }
    })
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })

    await ctx.prisma.deck.delete({ where: { id: deck.id } })

    return { ok: true }
  }),
})
