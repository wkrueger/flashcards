import { createTRPCReact } from "@trpc/react-query"
import { httpBatchLink } from "@trpc/client"
import { TRPCClientError } from "@trpc/client"
import { toast } from "sonner"
import type { AppRouter } from "server/router"

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
    }),
  ],
})

export function handleTRPCError(err: unknown) {
  if (err instanceof TRPCClientError) {
    if (err.data?.code === "UNAUTHORIZED") {
      window.location.href = "/login"
      return
    }
    console.error("[trpc]", err)
    toast.error(err.message)
  } else {
    console.error("[trpc] unexpected error", err)
    toast.error("An unexpected error occurred.")
  }
}
