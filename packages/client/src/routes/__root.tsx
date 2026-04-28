import { createRootRoute, Outlet, redirect } from "@tanstack/react-router"
import { Toaster } from "sonner"
import { AppShell } from "../components/AppShell"
import { getSessionCached } from "../infra/auth-client"

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
])

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (PUBLIC_PATHS.has(location.pathname)) return
    const { data } = await getSessionCached()
    if (!data?.user) {
      throw redirect({ to: "/login", replace: true })
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
          <button className="text-sm underline" onClick={() => window.location.replace("/")}>
            Go home
          </button>
        </div>
      </AppShell>
      <Toaster richColors position="bottom-center" />
    </>
  ),
})
