import { router, publicProcedure } from "../../infra/trpc.js"

export const languagesRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    ctx.prisma.language.findMany({ orderBy: { name: "asc" } })
  ),
})
