import { TRPCError } from "@trpc/server"
import { Prisma } from "../../generated/prisma/client.js"
import { createCardInput, idInput, updateCardInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { deleteSubjectIfEmpty, upsertSubjectByText } from "../Subjects/subjectsService.js"
import { hashFront, normalizeCardTags, tagOwnershipFor } from "./cardsService.js"

type Db = import("../../generated/prisma/client.js").PrismaClient

const cardInclude = Prisma.validator<Prisma.CardInclude>()({
  subject: { select: { subject: true } },
  deck: true,
  cardTags: {
    include: { tag: true },
  },
})

function serializeCard(card: Prisma.CardGetPayload<{ include: typeof cardInclude }>) {
  return {
    ...card,
    tags: card.cardTags.map((cardTag) => cardTag.tag.name).sort(),
  }
}

function buildTagLinks(userId: string, tags: string[]) {
  return normalizeCardTags(tags).map((name) => {
    const ownership = tagOwnershipFor(userId, name)

    return {
      tag: {
        connectOrCreate: {
          where: {
            ownerKey_name: {
              ownerKey: ownership.ownerKey,
              name,
            },
          },
          create: {
            ...ownership,
            name,
          },
        },
      },
    }
  })
}

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
    include: cardInclude,
  })
  if (!card) throw new TRPCError({ code: "NOT_FOUND" })
  return card
}

export const cardsRouter = router({
  listByDeck: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    await ownDeck(ctx.prisma, ctx.user.id, input.id)
    const cards = await ctx.prisma.card.findMany({
      where: { deckId: input.id },
      orderBy: { createdAt: "desc" },
      include: cardInclude,
    })
    return cards.map(serializeCard)
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return serializeCard(await ownCard(ctx.prisma, ctx.user.id, input.id))
  }),

  create: protectedProcedure.input(createCardInput).mutation(async ({ ctx, input }) => {
    await ownDeck(ctx.prisma, ctx.user.id, input.deckId)
    const frontHash = hashFront(input.front)
    const tagLinks = buildTagLinks(ctx.user.id, input.tags)
    try {
      const card = await ctx.prisma.$transaction(async (tx) => {
        const subject = await upsertSubjectByText(tx, ctx.user.id, input.deckId, input.subjectText)
        return tx.card.create({
          data: {
            deckId: input.deckId,
            subjectId: subject.id,
            front: input.front,
            frontHash,
            back: input.back,
            genTemplate: input.genTemplate ?? null,
            cardTags: {
              create: tagLinks,
            },
          },
          include: cardInclude,
        })
      })
      return serializeCard(card)
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
    if (input.tags !== undefined) {
      data.cardTags = {
        deleteMany: {},
        create: buildTagLinks(ctx.user.id, input.tags),
      }
    }
    try {
      const updated = await ctx.prisma.$transaction(async (tx) => {
        let previousSubjectId: string | undefined
        if (input.subjectText !== undefined) {
          const subject = await upsertSubjectByText(tx, ctx.user.id, card.deckId, input.subjectText)
          data.subject = { connect: { id: subject.id } }
          if (subject.id !== card.subjectId) previousSubjectId = card.subjectId
        }

        const updatedCard = await tx.card.update({
          where: { id: card.id },
          data,
          include: cardInclude,
        })
        if (previousSubjectId) await deleteSubjectIfEmpty(tx, previousSubjectId, card.deckId)
        return updatedCard
      })
      return serializeCard(updated)
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
    await ctx.prisma.$transaction(async (tx) => {
      await tx.card.delete({ where: { id: card.id } })
      await deleteSubjectIfEmpty(tx, card.subjectId, card.deckId)
    })
    return { ok: true }
  }),
})
