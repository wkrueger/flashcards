import { TRPCError } from "@trpc/server"
import { reviewCompleteInput, reviewNextInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { completeReview, pickNextCard } from "./review.service.js"

export const reviewRouter = router({
  next: protectedProcedure.input(reviewNextInput).query(async ({ ctx, input }) => {
    return pickNextCard({
      prisma: ctx.prisma,
      userId: ctx.user.id,
      deckId: input.deckId,
      includeOnCooldown: input.mode === "free",
    })
  }),

  complete: protectedProcedure.input(reviewCompleteInput).mutation(async ({ ctx, input }) => {
    try {
      return await completeReview(ctx.prisma, ctx.user.id, input.cardId, input.chosenLevel)
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
})
