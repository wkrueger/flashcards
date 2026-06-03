import { protectedProcedure, router } from "../../infra/trpc.js"

export const languagesRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.language.findMany({ orderBy: { name: "asc" } })
  ),
})
