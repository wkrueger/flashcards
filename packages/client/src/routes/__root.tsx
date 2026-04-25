import { createRootRoute, Outlet, redirect } from "@tanstack/react-router"
import { AppShell } from "../components/AppShell"
import { authClient } from "../infra/auth-client"

const PUBLIC = new Set(["/login", "/signup"])

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (PUBLIC.has(location.pathname)) return
    const { data } = await authClient.getSession()
    if (!data?.user) {
      throw redirect({ to: "/login" })
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
