import {
  type SequentialMove,
  type SequentialResult,
  sequentialCard as sequentialCardShared,
} from "@cards/shared"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { PrismaReviewStore } from "./PrismaReviewStore.js"

export type { SequentialResult }

// Thin wrapper over the shared sequential navigation logic
// (packages/shared/src/Review/SequentialSelection.ts), backed by the Prisma store.
export async function sequentialCard(args: {
  prisma: PrismaClient
  userId: string
  deckId: string
  cardId?: string
  subjectId?: string
  move: SequentialMove
}): Promise<SequentialResult> {
  const store = new PrismaReviewStore(args.prisma, args.userId)
  return sequentialCardShared({
    store,
    userId: args.userId,
    deckId: args.deckId,
    cardId: args.cardId,
    subjectId: args.subjectId,
    move: args.move,
  })
}
