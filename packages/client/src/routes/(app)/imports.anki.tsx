import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/(app)/imports/anki")({
  component: () => <Outlet />,
})
