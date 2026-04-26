import { useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import {
  buttonsForPrevious,
  COOLDOWN_LABEL,
  FIXATION_EMOJI,
  type FixationLevel,
  fixationLevelSchema,
  type ReviewMode,
} from "@cards/shared"

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
}
import { trpc } from "../../infra/trpc"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../lib/utils"

export function ReviewPage({ mode }: { mode: ReviewMode }) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [revealed, setRevealed] = useState(false)

  const next = trpc.review.next.useQuery({ deckId, mode }, { refetchOnWindowFocus: false })
  const complete = trpc.review.complete.useMutation({
    onSuccess: () => {
      setRevealed(false)
      utils.review.next.invalidate()
      utils.cards.listByDeck.invalidate({ id: deckId })
    },
  })

  if (next.isLoading) return <p>Loading…</p>

  if (!next.data?.card) {
    if (mode === "normal") {
      return (
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">All caught up</h1>
          <p className="text-sm text-muted-foreground">No cards are due in this deck.</p>
          <div className="flex flex-col gap-2">
            <Link
              to="/decks/$deckId/review/free"
              params={{ deckId }}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Free review (ignore cooldowns)
            </Link>
            <Link
              to="/decks/$deckId"
              params={{ deckId }}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Back to deck
            </Link>
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-4 text-center">
        <p>No cards in this deck.</p>
        <Link
          to="/decks/$deckId"
          params={{ deckId }}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back
        </Link>
      </div>
    )
  }

  const card = next.data.card
  const prev = fixationLevelSchema.parse(card.subject.fixationLevel)
  const options = buttonsForPrevious(prev)

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        subtitle={mode === "free" ? "Free review" : undefined}
        onBack={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit card"
            onClick={() =>
              navigate({
                to: "/decks/$deckId/cards/$cardId/edit",
                params: { deckId, cardId: card.id },
              })
            }
          >
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />

      <Card>
        <CardContent className="min-h-[8rem] p-4">
          <MarkdownView source={card.front} />
        </CardContent>
      </Card>

      {revealed ? (
        <>
          <Card>
            <CardContent className="min-h-[8rem] p-4">
              <MarkdownView source={card.back} />
            </CardContent>
          </Card>
          <div className="-mx-3 mt-auto grid grid-cols-4 gap-2">
            {options.map((lvl: FixationLevel, idx: number) => (
              <button
                key={lvl}
                type="button"
                disabled={complete.isPending}
                onClick={() => complete.mutate({ cardId: card.id, chosenLevel: lvl })}
                aria-label={`${lvl} - ${COOLDOWN_LABEL[lvl]}`}
                className={cn(
                  "flex h-20 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50",
                  idx === 0 && "rounded-bl-[2.5rem]",
                  idx === options.length - 1 && "rounded-br-[2.5rem]",
                  LEVEL_COLOR[lvl]
                )}
              >
                <span className="text-3xl leading-none">{FIXATION_EMOJI[lvl]}</span>
                <span className="text-sm opacity-90">{COOLDOWN_LABEL[lvl]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Button className="mt-auto w-full" onClick={() => setRevealed(true)}>
          Reveal
        </Button>
      )}
    </div>
  )
}
