import type { PrismaClient } from "../../generated/prisma/client.js"

export function normalizeSubjectText(text: string) {
  return text.trim()
}

export function subjectKeyFor(text: string) {
  return normalizeSubjectText(text).toLocaleLowerCase()
}

export async function upsertSubjectByText(prisma: PrismaClient, userId: string, text: string) {
  const subject = normalizeSubjectText(text)
  const subjectKey = subjectKeyFor(subject)

  return prisma.subject.upsert({
    where: { userId_subjectKey: { userId, subjectKey } },
    update: {},
    create: { userId, subject, subjectKey },
  })
}
