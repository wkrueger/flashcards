import { createTRPCReact } from "@trpc/react-query"
import { httpBatchLink } from "@trpc/client"
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
