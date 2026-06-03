import { Link, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router"
import { Layers, Trash2 } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { CardForm } from "./CardForm"
import { MenuItem, PageHeader } from "../../components/AppShell"
import { buttonVariants } from "../../ui/Button"
import { cn } from "../../Lib/Utils"

export function CardEditPage() {
  const { deckId, cardId } = useParams({
    from: "/(app)/decks/$deckId/cards/$cardId/edit",
  })
  const navigate = useNavigate()
  const router = useRouter()
  const search = useSearch({ from: "/(app)/decks/$deckId/cards/$cardId/edit" })
  const utils = trpc.useUtils()
  const card = trpc.cards.get.useQuery({ id: cardId })
  const rawSearch = new URLSearchParams(window.location.search)
  const returnToReviewCard =
    search.returnToReviewCard || rawSearch.get("returnToReviewCard") === "true"
  const reviewMode =
    search.reviewMode ?? (rawSearch.get("reviewMode") === "free" ? "free" : "normal")

  const goBack = () => {
    if (returnToReviewCard) {
      navigate({
        to: "/decks/$deckId/review/cards/$cardId",
        params: { deckId, cardId },
        search: { mode: reviewMode },
        replace: true,
      })
      return
    }
    if (window.history.length > 1) router.history.back()
    else navigate({ to: "/decks/$deckId", params: { deckId } })
  }

  const update = trpc.cards.update.useMutation({
    onSuccess: (updatedCard) => {
      utils.cards.get.setData({ id: cardId }, updatedCard)
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.review.next.invalidate()
      if (returnToReviewCard) {
        navigate({
          to: "/decks/$deckId/review/cards/$cardId",
          params: { deckId, cardId },
          search: { mode: reviewMode },
          replace: true,
        })
        return
      }
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

  if (card.isLoading) return <p></p>
  if (!card.data) return <p>Not found</p>

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        title="Edit card"
        onBack={goBack}
        actions={
          <Link
            to="/decks/$deckId/subjects/$subjectId"
            params={{ deckId, subjectId: card.data.subjectId }}
            aria-label="View subject cards"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
          >
            <Layers className="h-4 w-4" />
            Subject
          </Link>
        }
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
        deckId={deckId}
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
