import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/decks/$deckId")({
  component: () => <Outlet />,
})
