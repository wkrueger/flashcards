import { Link, useParams } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { buttonVariants } from "../../ui/button"
import { cn } from "../../lib/utils"

export function DeckDetailPage() {
  const { deckId } = useParams({ from: "/decks/$deckId" })
  const deck = trpc.decks.get.useQuery({ id: deckId })
  const cards = trpc.cards.listByDeck.useQuery({ id: deckId })
  const next = trpc.review.next.useQuery({ deckId, mode: "normal" })
  const dueCount = next.data?.dueCount ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          aria-label="Back to decks"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">{deck.data?.name ?? "Deck"}</h1>
      </div>

      <div className="flex flex-col gap-2">
        {dueCount > 0 ? (
          <Link
            to="/decks/$deckId/review"
            params={{ deckId }}
            className={cn(buttonVariants({ variant: "default" }))}
          >
            Review {dueCount} due
          </Link>
        ) : (
          <Link
            to="/decks/$deckId/review/free"
            params={{ deckId }}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Free review (no cards due)
          </Link>
        )}
        <Link
          to="/decks/$deckId/cards/new"
          params={{ deckId }}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          + New card
        </Link>
      </div>

      <h2 className="pt-4 text-sm font-semibold uppercase text-muted-foreground">Cards</h2>
      {cards.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cards.data && cards.data.length > 0 ? (
        <ul className="space-y-1">
          {cards.data.map((c) => (
            <li key={c.id}>
              <Link
                to="/decks/$deckId/cards/$cardId/edit"
                params={{ deckId, cardId: c.id }}
                className="block rounded-md border p-2 text-sm hover:bg-accent"
              >
                <span className="font-medium">{c.subject.subject}</span>
                <span className="ml-2 text-muted-foreground">
                  {c.front.replace(/[*_`]/g, "").slice(0, 60)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No cards yet.</p>
      )}
    </div>
  )
}
