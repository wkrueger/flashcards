import { COMPLETION_POINTS, type FixationLevel } from "@cards/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"

type Db = PrismaClient | Prisma.TransactionClient

export const COMPLETION_STALE_MS = 24 * 60 * 60 * 1000

export function pointsFor(level: string): number {
  return COMPLETION_POINTS[level as FixationLevel] ?? 0
}

export function completionPercent(score: number | null, subjectCount: number): number | null {
  if (score == null || subjectCount <= 0) return null
  return Math.round((score / subjectCount) * 100)
}

export async function recomputeDeckCompletion(db: Db, deckId: string, now = new Date()) {
  const groups = await db.subject.groupBy({
    by: ["fixationLevel"],
    where: { deckId },
    _count: true,
  })
  let score = 0
  for (const group of groups) {
    score += pointsFor(group.fixationLevel) * group._count
  }
  await db.deck.update({
    where: { id: deckId },
    data: { completionScore: score, completionComputedAt: now },
  })
  return score
}

export async function markDeckCompletionStale(db: Db, deckId: string) {
  await db.deck.update({
    where: { id: deckId },
    data: { completionScore: null, completionComputedAt: null },
  })
}
