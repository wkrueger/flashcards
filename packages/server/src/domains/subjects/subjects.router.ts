import { subjectAutocompleteInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { subjectKeyFor } from "./subjects.service.js"

export const subjectsRouter = router({
  autocomplete: protectedProcedure.input(subjectAutocompleteInput).query(async ({ ctx, input }) => {
    if (input.query.length === 0) return []
    return ctx.prisma.subject.findMany({
      where: {
        userId: ctx.user.id,
        subjectKey: { startsWith: subjectKeyFor(input.query) },
      },
      orderBy: { subject: "asc" },
      take: 10,
      select: { id: true, subject: true },
    })
  }),
})
