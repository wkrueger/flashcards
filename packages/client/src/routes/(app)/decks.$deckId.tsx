import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/(app)/decks/$deckId")({
  component: () => <Outlet />,
})
