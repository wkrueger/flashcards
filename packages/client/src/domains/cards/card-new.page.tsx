import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { Sparkles } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./card-form"
import { buttonVariants } from "../../ui/button"
import { cn } from "../../lib/utils"
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
    <div className="space-y-3">
      <PageHeader title="New card" onBack={goBack} />
      <CardForm
        initial={{ subjectText: "", front: "", back: "" }}
        submitLabel="Create"
        pending={create.isPending}
        error={create.error?.message ?? null}
        onSubmit={(v) => create.mutate({ deckId, ...v })}
      />
      <Link
        to="/decks/$deckId/cards/generate"
        params={{ deckId }}
        className={cn(buttonVariants({ variant: "secondary", className: "w-full gap-2" }))}
      >
        <Sparkles className="h-4 w-4" />
        Generate card from template
      </Link>
    </div>
  )
}
