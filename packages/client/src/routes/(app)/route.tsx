import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import { useSession } from "../../infra/authClient"

export const Route = createFileRoute("/(app)")({
  component: AppLayout,
})

function AppLayout() {
  const router = useRouter()
  const { data, isPending } = useSession()

  useEffect(() => {
    if (!isPending && !data?.user) {
      router.navigate({ to: "/login", replace: true })
    }
  }, [isPending, data, router])

  return <Outlet />
}
