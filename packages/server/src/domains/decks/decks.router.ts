import { TRPCError } from "@trpc/server"
import { createDeckInput, idInput, renameDeckInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"

export const decksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { cards: true } } },
    })
    return decks.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      cardCount: d._count.cards,
    }))
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [deck, cardCount, wordCount] = await Promise.all([
      ctx.prisma.deck.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      }),
      ctx.prisma.card.count({ where: { deckId: input.id } }),
      ctx.prisma.subject.count({
        where: { cards: { some: { deckId: input.id } }, userId: ctx.user.id },
      }),
    ])
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    return { id: deck.id, name: deck.name, createdAt: deck.createdAt, cardCount, wordCount }
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
    return ctx.prisma.deck.create({
      data: { name: input.name, userId: ctx.user.id },
    })
  }),

  rename: protectedProcedure.input(renameDeckInput).mutation(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    return ctx.prisma.deck.update({
      where: { id: deck.id },
      data: { name: input.name },
    })
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })

    // Collect subjects that only have cards in this deck before we delete.
    const orphanedSubjects = await ctx.prisma.subject.findMany({
      where: {
        userId: ctx.user.id,
        cards: {
          every: { deckId: deck.id },
          some: {},
        },
      },
      select: { id: true },
    })
    const orphanedIds = orphanedSubjects.map((s) => s.id)

    await ctx.prisma.$transaction([
      // Cascade deletes cards automatically; subjects need explicit cleanup.
      ctx.prisma.deck.delete({ where: { id: deck.id } }),
      ...(orphanedIds.length
        ? [ctx.prisma.subject.deleteMany({ where: { id: { in: orphanedIds } } })]
        : []),
    ])

    return { ok: true }
  }),
})
