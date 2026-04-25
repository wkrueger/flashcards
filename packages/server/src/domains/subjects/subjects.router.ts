import { subjectAutocompleteInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"

export const subjectsRouter = router({
  autocomplete: protectedProcedure.input(subjectAutocompleteInput).query(async ({ ctx, input }) => {
    if (input.query.length === 0) return []
    return ctx.prisma.subject.findMany({
      where: {
        userId: ctx.user.id,
        subject: { startsWith: input.query },
      },
      orderBy: { subject: "asc" },
      take: 10,
      select: { id: true, subject: true },
    })
  }),
})
