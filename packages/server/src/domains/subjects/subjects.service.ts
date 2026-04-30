import { randomInt } from "node:crypto"
import type { PrismaClient } from "../../generated/prisma/client.js"

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

export async function upsertSubjectByText(prisma: PrismaClient, userId: string, text: string) {
  const subject = normalizeSubjectText(text)
  const subjectKey = subjectKeyFor(subject)

  return prisma.subject.upsert({
    where: { userId_subjectKey: { userId, subjectKey } },
    update: {},
    create: { userId, subject, subjectKey, randomKey: randomSubjectKey() },
  })
}
