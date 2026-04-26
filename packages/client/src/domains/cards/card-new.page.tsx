import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./card-form"
import { PageHeader } from "../../components/AppShell"

export function CardNewPage() {
  const { deckId } = useParams({ from: "/decks/$deckId/cards/new" })
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()

  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: "/decks/$deckId", params: { deckId } })
  }

  const create = trpc.cards.create.useMutation({
    onSuccess: () => {
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.list.invalidate()
      utils.review.next.invalidate()
      goBack()
    },
  })

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader title="New card" onBack={goBack} />
      <CardForm
        initial={{ subjectText: "", front: "", back: "" }}
        submitLabel="Create"
        pending={create.isPending}
        error={create.error?.message ?? null}
        onSubmit={(v) => create.mutate({ deckId, ...v })}
      />
    </div>
  )
}
