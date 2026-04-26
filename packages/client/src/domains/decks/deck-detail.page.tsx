import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, Trash2 } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { Button, buttonVariants } from "../../ui/button"
import { cn } from "../../lib/utils"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../ui/dialog"

export function DeckDetailPage() {
  const { deckId } = useParams({ from: "/decks/$deckId" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const deck = trpc.decks.get.useQuery({ id: deckId })
  const next = trpc.review.next.useQuery({ deckId, mode: "normal" })
  const dueCount = next.data?.dueCount ?? 0

  const deleteDeck = trpc.decks.delete.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      navigate({ to: "/" })
    },
  })

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
        <h1 className="flex-1 text-xl font-semibold">{deck.data?.name ?? "Deck"}</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Delete deck">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete "{deck.data?.name}"?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the deck, all its cards, and any subjects that have no
              cards in other decks. This cannot be undone.
            </p>
            {deleteDeck.error && (
              <p className="text-sm text-destructive">{deleteDeck.error.message}</p>
            )}
            <div className="mt-4 flex gap-2">
              <DialogClose asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={deleteDeck.isPending}
                onClick={() => deleteDeck.mutate({ id: deckId })}
              >
                {deleteDeck.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4">
        <div className="text-center">
          <p className="text-2xl font-semibold">{deck.data?.cardCount ?? "—"}</p>
          <p className="text-xs text-muted-foreground">cards</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold">{deck.data?.wordCount ?? "—"}</p>
          <p className="text-xs text-muted-foreground">words</p>
        </div>
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
    </div>
  )
}
