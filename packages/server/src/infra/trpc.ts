import { initTRPC, TRPCError } from "@trpc/server"
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify"
import { auth } from "./auth.js"
import { prisma } from "./db.js"

export async function createContext({ req }: CreateFastifyContextOptions) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "))
    else if (value != null) headers.set(key, String(value))
  }
  const session = await auth.api.getSession({ headers })
  return {
    prisma,
    user: session?.user ?? null,
    session: session?.session ?? null,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

// For tests / direct invocation
export function createTestContext(
  overrides: Partial<Context> & { userId?: string | null }
): Context {
  const userId = overrides.userId
  return {
    prisma: overrides.prisma ?? prisma,
    user: userId ? ({ id: userId } as Context["user"]) : null,
    session: overrides.session ?? null,
  }
}
