import { createRootRoute, Outlet, redirect } from "@tanstack/react-router"
import { Toaster } from "sonner"
import { AppShell } from "../components/AppShell"
import { authClient } from "../infra/auth-client"

const PUBLIC = new Set(["/login", "/signup"])

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (PUBLIC.has(location.pathname)) return
    try {
      const { data } = await authClient.getSession()
      if (!data?.user) {
        throw redirect({ to: "/login" })
      }
    } catch (err) {
      // Only redirect to login for auth failures, not for server errors.
      if (err && typeof err === "object" && "href" in err) throw err // it's a redirect
      // Network / 500 errors: let the page render (tRPC will show its own error)
    }
  },
  component: () => (
    <>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster richColors position="bottom-center" />
    </>
  ),
  errorComponent: ({ error }) => (
    <>
      <AppShell>
        <div className="space-y-2 py-8 text-center">
          <p className="font-medium text-destructive">Something went wrong</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "An unexpected error occurred."}
          </p>
          <button
            className="text-sm underline"
            onClick={() => window.location.replace("/")}
          >
            Go home
          </button>
        </div>
      </AppShell>
      <Toaster richColors position="bottom-center" />
    </>
  ),
})
