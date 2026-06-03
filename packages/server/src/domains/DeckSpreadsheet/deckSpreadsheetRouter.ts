import { idInput } from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import { getSpreadsheetImportStatus } from "./deckSpreadsheetService/index.js"

export const deckSpreadsheetRouter = router({
  getImport: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return getSpreadsheetImportStatus(ctx.prisma, ctx.user.id, input.id)
  }),
})
