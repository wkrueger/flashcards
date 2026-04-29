import { PrismaClient } from "../generated/prisma/client.js"
import { createPrismaAdapter } from "./prisma-adapter.js"

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter: createPrismaAdapter(),
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  })

if (process.env.NODE_ENV !== "production") global.__prisma = prisma
