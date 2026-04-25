import { randomUUID } from "node:crypto"
import { prisma } from "../src/infra/db.js"
import { appRouter } from "../src/domains/_app.router.js"
import type { Context } from "../src/infra/trpc.js"

export async function makeUser(label = "user") {
  const id = `${label}-${randomUUID()}`
  await prisma.user.create({
    data: {
      id,
      name: label,
      email: `${id}@test.local`,
      emailVerified: true,
    },
  })
  return id
}

export function callerFor(userId: string) {
  const ctx: Context = {
    prisma,
    user: { id: userId } as Context["user"],
    session: null,
  }
  return appRouter.createCaller(ctx)
}

export async function resetDomain() {
  await prisma.card.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.deck.deleteMany()
  await prisma.user.deleteMany()
}
