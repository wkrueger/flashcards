import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { ArrowLeft, Sparkles } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./card-form"
import { Button, buttonVariants } from "../../ui/button"
import { cn } from "../../lib/utils"

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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">New card</h1>
      </div>
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
