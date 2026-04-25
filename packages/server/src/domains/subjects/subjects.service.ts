import type { PrismaClient } from "../../generated/prisma/client.js"

export async function upsertSubjectByText(prisma: PrismaClient, userId: string, text: string) {
  return prisma.subject.upsert({
    where: { userId_subject: { userId, subject: text } },
    update: {},
    create: { userId, subject: text },
  })
}
