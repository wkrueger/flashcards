import { TRPCError } from "@trpc/server"

const buckets = new Map<string, number[]>()

interface Options {
  windowMs: number
  max: number
}

export function rateLimit(key: string, { windowMs, max }: Options): void {
  const now = Date.now()
  const cutoff = now - windowMs
  const arr = (buckets.get(key) ?? []).filter((t) => t > cutoff)
  if (arr.length >= max) {
    const retryAfter = Math.ceil((arr[0]! + windowMs - now) / 1000)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
    })
  }
  arr.push(now)
  buckets.set(key, arr)
}

export function __resetRateLimitForTests(): void {
  buckets.clear()
}
