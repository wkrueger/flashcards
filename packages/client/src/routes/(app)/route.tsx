import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { getSessionCached } from "../../infra/auth-client"

export const Route = createFileRoute("/(app)")({
  beforeLoad: async () => {
    const { data } = await getSessionCached()
    if (!data?.user) {
      throw redirect({ to: "/login", replace: true })
    }
  },
  component: () => <Outlet />,
})
