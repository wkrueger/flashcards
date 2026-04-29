import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./card-form"
import { MenuItem, PageHeader } from "../../components/AppShell"

export function CardEditPage() {
  const { deckId, cardId } = useParams({
    from: "/(app)/decks/$deckId/cards/$cardId/edit",
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
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        title="Edit card"
        onBack={goBack}
        menuItems={
          <MenuItem
            icon={<Trash2 className="h-[18px] w-[18px]" />}
            destructive
            onSelect={() => {
              if (confirm("Delete this card?")) del.mutate({ id: cardId })
            }}
          >
            Delete card
          </MenuItem>
        }
      />
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
    </div>
  )
}
