import { TRPCError } from "@trpc/server"
import { offlineSnapshotInput, offlineSyncReviewsInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { advanceCard, completeReview } from "../Review/reviewService.js"

function isCardNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException & { code?: string }).code === "CARD_NOT_FOUND"
  )
}

export const offlineRouter = router({
  // Full per-deck state the client needs to review offline: deck config + every subject
  // (with selection fields) + every card (with tags). Scoped to the authenticated user.
  snapshot: protectedProcedure.input(offlineSnapshotInput).query(async ({ ctx, input }) => {
    const deck = await ctx.prisma.deck.findFirst({
      where: { id: input.deckId, userId: ctx.user.id },
      include: { defaultBackLanguage: { select: { speechRecognitionLocale: true } } },
    })
    if (!deck) throw new TRPCError({ code: "NOT_FOUND" })

    const [subjects, cards] = await Promise.all([
      ctx.prisma.subject.findMany({
        where: { deckId: deck.id, userId: ctx.user.id },
        select: {
          id: true,
          subject: true,
          fixationLevel: true,
          inverseReviewed: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastSeenShuffle: true,
          cooldownAt: true,
          randomKey: true,
          order: true,
          createdAt: true,
        },
      }),
      ctx.prisma.card.findMany({
        where: { deckId: deck.id, deck: { userId: ctx.user.id } },
        select: {
          id: true,
          deckId: true,
          subjectId: true,
          front: true,
          back: true,
          genTemplate: true,
          order: true,
          createdAt: true,
          lastSeenAt: true,
          cardTags: { include: { tag: { select: { name: true } } } },
        },
      }),
    ])

    return {
      fetchedAt: new Date().toISOString(),
      deck: {
        id: deck.id,
        name: deck.name,
        sequentialEnabled: deck.sequentialEnabled,
        speechRecognitionEnabled: deck.speechRecognitionEnabled,
        speechRecognitionLocale: deck.defaultBackLanguage?.speechRecognitionLocale ?? null,
        inverseReviewEnabled: deck.inverseReviewEnabled,
        inverseReviewStreak: deck.inverseReviewStreak,
      },
      subjects,
      cards: cards.map(({ cardTags, ...card }) => ({
        ...card,
        tags: cardTags.map((ct) => ct.tag.name).sort(),
      })),
    }
  }),

  // Replay queued offline reviews in completedAt order, recomputing cooldowns from the captured
  // timestamps (last write wins per subject). Cards deleted/edited online while offline are skipped.
  syncReviews: protectedProcedure
    .input(offlineSyncReviewsInput)
    .mutation(async ({ ctx, input }) => {
      const ordered = [...input.reviews].sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      )

      const results: Array<{
        cardId: string
        completedAt: string
        ok: boolean
        reason?: "NOT_FOUND"
      }> = []

      for (const review of ordered) {
        try {
          if (review.advance) {
            await advanceCard(ctx.prisma, ctx.user.id, review.cardId, new Date(review.completedAt))
          } else {
            await completeReview(
              ctx.prisma,
              ctx.user.id,
              review.cardId,
              { chosenLevel: review.chosenLevel, inverse: review.inverse },
              new Date(review.completedAt)
            )
          }
          results.push({ cardId: review.cardId, completedAt: review.completedAt, ok: true })
        } catch (err) {
          if (isCardNotFound(err)) {
            results.push({
              cardId: review.cardId,
              completedAt: review.completedAt,
              ok: false,
              reason: "NOT_FOUND",
            })
            continue
          }
          throw err
        }
      }

      return {
        synced: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok).length,
        results,
      }
    }),
})
