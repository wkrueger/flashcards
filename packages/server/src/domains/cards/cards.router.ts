import { TRPCError } from "@trpc/server"
import { Prisma } from "../../generated/prisma/client.js"
import { createCardInput, idInput, updateCardInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { upsertSubjectByText } from "../subjects/subjects.service.js"
import { hashFront } from "./cards.service.js"

type Db = import("../../generated/prisma/client.js").PrismaClient

function isUniqueConstraintError(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002"
}

async function ownDeck(prisma: Db, userId: string, deckId: string) {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId },
  })
  if (!deck) throw new TRPCError({ code: "NOT_FOUND", message: "Deck not found" })
  return deck
}

async function ownCard(prisma: Db, userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { subject: true, deck: true },
  })
  if (!card) throw new TRPCError({ code: "NOT_FOUND" })
  return card
}

export const cardsRouter = router({
  listByDeck: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    await ownDeck(ctx.prisma, ctx.user.id, input.id)
    return ctx.prisma.card.findMany({
      where: { deckId: input.id },
      orderBy: { createdAt: "desc" },
      include: { subject: { select: { subject: true } } },
    })
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return ownCard(ctx.prisma, ctx.user.id, input.id)
  }),

  create: protectedProcedure.input(createCardInput).mutation(async ({ ctx, input }) => {
    await ownDeck(ctx.prisma, ctx.user.id, input.deckId)
    const subject = await upsertSubjectByText(ctx.prisma, ctx.user.id, input.subjectText)
    const frontHash = hashFront(input.front)
    try {
      return await ctx.prisma.card.create({
        data: {
          deckId: input.deckId,
          subjectId: subject.id,
          front: input.front,
          frontHash,
          back: input.back,
        },
      })
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A card with this subject and front already exists.",
        })
      }
      throw err
    }
  }),

  update: protectedProcedure.input(updateCardInput).mutation(async ({ ctx, input }) => {
    const card = await ownCard(ctx.prisma, ctx.user.id, input.id)
    const data: Prisma.CardUpdateInput = {}
    if (input.front !== undefined) {
      data.front = input.front
      data.frontHash = hashFront(input.front)
    }
    if (input.back !== undefined) data.back = input.back
    if (input.subjectText !== undefined) {
      const subject = await upsertSubjectByText(ctx.prisma, ctx.user.id, input.subjectText)
      data.subject = { connect: { id: subject.id } }
    }
    try {
      return await ctx.prisma.card.update({
        where: { id: card.id },
        data,
      })
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A card with this subject and front already exists.",
        })
      }
      throw err
    }
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const card = await ownCard(ctx.prisma, ctx.user.id, input.id)
    await ctx.prisma.card.delete({ where: { id: card.id } })
    return { ok: true }
  }),
})
