import { TRPCError } from "@trpc/server"
import { Prisma } from "../../generated/prisma/client.js"
import { idInput, renameSubjectInput, subjectAutocompleteInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { normalizeSubjectText, subjectKeyFor } from "./subjects.service.js"

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
          orderBy: { createdAt: "desc" },
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
      select: { id: true },
    })
    if (!subject) throw new TRPCError({ code: "NOT_FOUND" })
    await ctx.prisma.subject.delete({ where: { id: subject.id } })
    return { ok: true }
  }),
})
