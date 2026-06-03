import React from "react"
import ReactDOM from "react-dom/client"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { TRPCClientError } from "@trpc/client"
import { toast } from "./infra/toast"
import { trpc, trpcClient } from "./infra/trpc"
import { ThemeProvider } from "./infra/theme"
import { getSessionCached } from "./infra/authClient"
import { routeTree } from "./routeTree.gen"
import "./styles.css"

void getSessionCached()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false } },
  queryCache: new QueryCache({
    onError(err) {
      if (err instanceof TRPCClientError) {
        if (err.data?.code === "UNAUTHORIZED") {
          window.location.href = "/login"
          return
        }
        console.error("[trpc query]", err)
        toast.error(err.message)
      }
    },
  }),
})

const router = createRouter({
  routeTree,
  defaultPreload: "viewport",
  defaultPreloadStaleTime: 30_000,
  defaultViewTransition: true,
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
  defaultPendingComponent: () => null,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </trpc.Provider>
    </ThemeProvider>
  </React.StrictMode>
)
