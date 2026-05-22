import { randomInt } from "node:crypto"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"

export const SUBJECT_RANDOM_KEY_RANGE = 2_147_483_647

export function normalizeSubjectText(text: string) {
  return text.trim()
}

export function subjectKeyFor(text: string) {
  return normalizeSubjectText(text).toLocaleLowerCase()
}

export function randomSubjectKey() {
  return randomInt(SUBJECT_RANDOM_KEY_RANGE)
}

export function randomSubjectKeyFromRng(rng: () => number) {
  return Math.floor(rng() * SUBJECT_RANDOM_KEY_RANGE)
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

export async function deleteSubjectIfEmpty(prisma: SubjectDb, subjectId: string) {
  return prisma.subject.deleteMany({
    where: {
      id: subjectId,
      cards: { none: {} },
    },
  })
}

export async function deleteEmptySubjectsForDeck(
  prisma: SubjectDb,
  userId: string,
  deckId: string
) {
  return prisma.subject.deleteMany({
    where: {
      userId,
      deckId,
      cards: { none: {} },
    },
  })
}
