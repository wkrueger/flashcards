import { TRPCError } from "@trpc/server"
import { Prisma } from "../../generated/prisma/client.js"
import {
  idInput,
  renameSubjectInput,
  reorderCardInput,
  subjectAutocompleteInput,
} from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { normalizeSubjectText, subjectKeyFor } from "./subjectsService.js"
import { markDeckCompletionStale } from "../Decks/deckCompletionService.js"

const subjectCardInclude = Prisma.validator<Prisma.CardInclude>()({
  cardTags: { include: { tag: true } },
})

function serializeSubjectCard(card: Prisma.CardGetPayload<{ include: typeof subjectCardInclude }>) {
  return {
    id: card.id,
    deckId: card.deckId,
    subjectId: card.subjectId,
    front: card.front,
    back: card.back,
    genTemplate: card.genTemplate,
    createdAt: card.createdAt,
    tags: card.cardTags.map((cardTag) => cardTag.tag.name).sort(),
  }
}

export const subjectsRouter = router({
  autocomplete: protectedProcedure.input(subjectAutocompleteInput).query(async ({ ctx, input }) => {
    if (input.query.length === 0) return []
    return ctx.prisma.subject.findMany({
      where: {
        userId: ctx.user.id,
        deckId: input.deckId,
        subjectKey: { startsWith: subjectKeyFor(input.query) },
      },
      orderBy: { subject: "asc" },
      take: 10,
      select: { id: true, subject: true },
    })
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const subject = await ctx.prisma.subject.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      include: {
        cards: {
          orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          include: subjectCardInclude,
        },
      },
    })
    if (!subject) throw new TRPCError({ code: "NOT_FOUND" })
    return {
      id: subject.id,
      subject: subject.subject,
      cards: subject.cards.map(serializeSubjectCard),
    }
  }),

  rename: protectedProcedure.input(renameSubjectInput).mutation(async ({ ctx, input }) => {
    const subject = await ctx.prisma.subject.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true, deckId: true, subjectKey: true },
    })
    if (!subject) throw new TRPCError({ code: "NOT_FOUND" })
    const nextSubject = normalizeSubjectText(input.subject)
    const nextKey = subjectKeyFor(nextSubject)
    if (nextKey !== subject.subjectKey) {
      const conflict = await ctx.prisma.subject.findFirst({
        where: {
          deckId: subject.deckId,
          subjectKey: nextKey,
          NOT: { id: subject.id },
        },
        select: { id: true },
      })
      if (conflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another subject with that name already exists.",
        })
      }
    }
    const updated = await ctx.prisma.subject.update({
      where: { id: subject.id },
      data: { subject: nextSubject, subjectKey: nextKey },
      select: { id: true, subject: true },
    })
    return updated
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const subject = await ctx.prisma.subject.findFirst({
      where: { id: input.id, userId: ctx.user.id },
      select: { id: true, deckId: true },
    })
    if (!subject) throw new TRPCError({ code: "NOT_FOUND" })
    await ctx.prisma.subject.delete({ where: { id: subject.id } })
    await markDeckCompletionStale(ctx.prisma, subject.deckId)
    return { ok: true }
  }),

  reorderCard: protectedProcedure.input(reorderCardInput).mutation(async ({ ctx, input }) => {
    const card = await ctx.prisma.card.findFirst({
      where: { id: input.cardId, deck: { userId: ctx.user.id } },
      select: { id: true, subjectId: true },
    })
    if (!card) throw new TRPCError({ code: "NOT_FOUND" })

    const cards = await ctx.prisma.card.findMany({
      where: { subjectId: card.subjectId },
      orderBy: [{ order: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true },
    })
    const idx = cards.findIndex((c) => c.id === card.id)
    const swapIdx = input.direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= cards.length) return { ok: true }

    const reordered = [...cards]
    const tmp = reordered[idx]!
    reordered[idx] = reordered[swapIdx]!
    reordered[swapIdx] = tmp

    await ctx.prisma.$transaction(
      reordered.map((c, i) => ctx.prisma.card.update({ where: { id: c.id }, data: { order: i } }))
    )
    return { ok: true }
  }),
})
