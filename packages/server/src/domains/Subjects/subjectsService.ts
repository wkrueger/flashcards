import { randomInt } from "node:crypto"
import { SUBJECT_RANDOM_KEY_RANGE, randomSubjectKeyFromRng } from "@cards/shared"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { markDeckCompletionStale } from "../Decks/deckCompletionService.js"

// Re-exported from shared so existing importers keep working off a single source of truth.
export { SUBJECT_RANDOM_KEY_RANGE, randomSubjectKeyFromRng }

export function normalizeSubjectText(text: string) {
  return text.trim()
}

export function subjectKeyFor(text: string) {
  return normalizeSubjectText(text).toLocaleLowerCase()
}

export function randomSubjectKey() {
  return randomInt(SUBJECT_RANDOM_KEY_RANGE)
}

type SubjectDb = PrismaClient | Prisma.TransactionClient

export async function upsertSubjectByText(
  prisma: SubjectDb,
  userId: string,
  deckId: string,
  text: string
) {
  const subject = normalizeSubjectText(text)
  const subjectKey = subjectKeyFor(subject)

  return prisma.subject.upsert({
    where: { deckId_subjectKey: { deckId, subjectKey } },
    update: {},
    create: { userId, deckId, subject, subjectKey, randomKey: randomSubjectKey() },
  })
}

export async function deleteSubjectIfEmpty(prisma: SubjectDb, subjectId: string, deckId: string) {
  const result = await prisma.subject.deleteMany({
    where: {
      id: subjectId,
      cards: { none: {} },
    },
  })
  if (result.count > 0) await markDeckCompletionStale(prisma, deckId)
  return result
}

export async function deleteEmptySubjectsForDeck(
  prisma: SubjectDb,
  userId: string,
  deckId: string
) {
  const result = await prisma.subject.deleteMany({
    where: {
      userId,
      deckId,
      cards: { none: {} },
    },
  })
  if (result.count > 0) await markDeckCompletionStale(prisma, deckId)
  return result
}
