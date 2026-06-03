import {
  idInput,
  previewCardTypeMappingInput,
  saveAnkiImportConfigurationInput,
} from "@cards/shared"
import { protectedProcedure, router } from "../../infra/trpc.js"
import {
  deleteImportProcess,
  getImportProcessView,
  listImportProcesses,
  previewCardTypeMapping,
  saveImportConfiguration,
  startImportProcess,
} from "./ankiImportService.js"

export const ankiImportRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listImportProcesses(ctx.prisma, ctx.user.id)
  }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return getImportProcessView(ctx.prisma, ctx.user.id, input.id)
  }),

  saveConfiguration: protectedProcedure
    .input(saveAnkiImportConfigurationInput)
    .mutation(async ({ ctx, input }) => {
      return saveImportConfiguration(ctx.prisma, {
        processId: input.id,
        userId: ctx.user.id,
        deck: input.deck,
        cardTypes: input.cardTypes,
      })
    }),

  startImport: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    return startImportProcess(ctx.prisma, ctx.user.id, input.id)
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await deleteImportProcess(ctx.prisma, ctx.user.id, input.id)
  }),

  previewMapping: protectedProcedure
    .input(previewCardTypeMappingInput)
    .mutation(async ({ ctx, input }) => {
      return previewCardTypeMapping(ctx.prisma, ctx.user.id, input)
    }),
})
