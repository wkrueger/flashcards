import { TRPCError } from "@trpc/server"
import {
  reviewAdvanceInput,
  reviewCompleteInput,
  reviewNextInput,
  reviewSequentialInput,
} from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { advanceCard, completeReview, pickNextCard } from "./reviewService.js"
import { sequentialCard } from "./reviewSequential.js"

export const reviewRouter = router({
  next: protectedProcedure.input(reviewNextInput).query(async ({ ctx, input }) => {
    return pickNextCard({
      prisma: ctx.prisma,
      userId: ctx.user.id,
      deckId: input.deckId,
      includeOnCooldown: input.mode === "free",
      excludeCardId: input.excludeCardId,
      subjectId: input.subjectId,
      cardId: input.cardId,
    })
  }),

  complete: protectedProcedure.input(reviewCompleteInput).mutation(async ({ ctx, input }) => {
    try {
      return await completeReview(ctx.prisma, ctx.user.id, input.cardId, {
        chosenLevel: input.chosenLevel,
        inverse: input.inverse,
      })
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "CARD_NOT_FOUND"
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      throw err
    }
  }),

  advance: protectedProcedure.input(reviewAdvanceInput).mutation(async ({ ctx, input }) => {
    try {
      return await advanceCard(ctx.prisma, ctx.user.id, input.cardId)
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "CARD_NOT_FOUND"
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      throw err
    }
  }),

  sequential: protectedProcedure.input(reviewSequentialInput).query(async ({ ctx, input }) => {
    try {
      return await sequentialCard({
        prisma: ctx.prisma,
        userId: ctx.user.id,
        deckId: input.deckId,
        cardId: input.cardId,
        move: input.move,
      })
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "DECK_NOT_FOUND"
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      throw err
    }
  }),
})
