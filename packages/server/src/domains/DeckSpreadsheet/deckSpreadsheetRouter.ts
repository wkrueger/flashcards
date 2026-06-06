import {
  batchIdInput,
  confirmDeckImportBatchInput,
  confirmDeckImportInput,
  idInput,
} from "@cards/shared"
import { TRPCError } from "@trpc/server"
import { protectedProcedure, router } from "../../infra/trpc.js"
import {
  confirmDeckSpreadsheetImport,
  getSpreadsheetImportStatus,
} from "./deckSpreadsheetService/index.js"
import {
  confirmDeckSpreadsheetImportBatch,
  getDeckSpreadsheetBatch,
} from "./deckSpreadsheetService/batch.js"
import { DeckSpreadsheetError } from "./deckSpreadsheetShared.js"

const errorCodeMap = {
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
} as const

export const deckSpreadsheetRouter = router({
  getImport: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return getSpreadsheetImportStatus(ctx.prisma, ctx.user.id, input.id)
  }),

  confirmImport: protectedProcedure
    .input(confirmDeckImportInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmDeckSpreadsheetImport(ctx.prisma, ctx.user.id, input)
      } catch (error) {
        if (error instanceof DeckSpreadsheetError) {
          throw new TRPCError({ code: errorCodeMap[error.code], message: error.message })
        }
        throw error
      }
    }),

  getBatch: protectedProcedure.input(batchIdInput).query(async ({ ctx, input }) => {
    try {
      return await getDeckSpreadsheetBatch(ctx.prisma, ctx.user.id, input.batchId)
    } catch (error) {
      if (error instanceof DeckSpreadsheetError) {
        throw new TRPCError({ code: errorCodeMap[error.code], message: error.message })
      }
      throw error
    }
  }),

  confirmBatch: protectedProcedure
    .input(confirmDeckImportBatchInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmDeckSpreadsheetImportBatch(ctx.prisma, ctx.user.id, input)
      } catch (error) {
        if (error instanceof DeckSpreadsheetError) {
          throw new TRPCError({ code: errorCodeMap[error.code], message: error.message })
        }
        throw error
      }
    }),
})
