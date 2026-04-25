import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./card-form"
import { Button } from "../../ui/button"

export function CardEditPage() {
  const { deckId, cardId } = useParams({
    from: "/decks/$deckId/cards/$cardId/edit",
  })
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()
  const card = trpc.cards.get.useQuery({ id: cardId })

  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: "/decks/$deckId", params: { deckId } })
  }

  const update = trpc.cards.update.useMutation({
    onSuccess: () => {
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.review.next.invalidate()
      goBack()
    },
  })
  const del = trpc.cards.delete.useMutation({
    onSuccess: () => {
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.list.invalidate()
      utils.review.next.invalidate()
      navigate({ to: "/decks/$deckId", params: { deckId } })
    },
  })

  if (card.isLoading) return <p>Loading…</p>
  if (!card.data) return <p>Not found</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">Edit card</h1>
      </div>
      <CardForm
        initial={{
          subjectText: card.data.subject.subject,
          front: card.data.front,
          back: card.data.back,
        }}
        submitLabel="Save"
        pending={update.isPending}
        error={update.error?.message ?? null}
        onSubmit={(v) => update.mutate({ id: cardId, ...v })}
      />
      <button
        type="button"
        className="w-full text-sm text-destructive underline"
        onClick={() => {
          if (confirm("Delete this card?")) del.mutate({ id: cardId })
        }}
      >
        Delete card
      </button>
    </div>
  )
}
