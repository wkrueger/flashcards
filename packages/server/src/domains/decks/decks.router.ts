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
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })
    return deck
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
    await ctx.prisma.deck.delete({ where: { id: deck.id } })
    return { ok: true }
  }),
})
