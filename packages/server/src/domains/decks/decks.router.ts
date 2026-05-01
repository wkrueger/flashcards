import { TRPCError } from "@trpc/server"
import { createDeckInput, idInput, updateDeckInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"

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
            cards: { some: { deckId: d.id } },
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
    const [deck, cardCount, wordCount, cooldownCount] = await Promise.all([
      ctx.prisma.deck.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      }),
      ctx.prisma.card.count({ where: { deckId: input.id } }),
      ctx.prisma.subject.count({
        where: { cards: { some: { deckId: input.id } }, userId: ctx.user.id },
      }),
      ctx.prisma.subject.count({
        where: {
          userId: ctx.user.id,
          cards: { some: { deckId: input.id } },
          cooldownAt: { gt: now },
        },
      }),
    ])
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    return {
      id: deck.id,
      name: deck.name,
      createdAt: deck.createdAt,
      defaultFrontLanguageId: deck.defaultFrontLanguageId,
      defaultBackLanguageId: deck.defaultBackLanguageId,
      inverseReviewEnabled: deck.inverseReviewEnabled,
      cardCount,
      wordCount,
      cooldownCount,
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
    if (input.inverseReviewEnabled !== undefined)
      data.inverseReviewEnabled = input.inverseReviewEnabled
    return ctx.prisma.deck.update({
      where: { id: deck.id },
      data,
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
