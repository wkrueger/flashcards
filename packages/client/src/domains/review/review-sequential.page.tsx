import { useEffect, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, Pencil, RotateCcw } from "lucide-react"
import {
  buttonsForPrevious,
  COOLDOWN_LABEL,
  FIXATION_EMOJI,
  FIXATION_LEVELS,
  type FixationLevel,
} from "@cards/shared/fixation"
import { trpc } from "../../infra/trpc"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../lib/utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { displayFrontWithGeneratedTagPrefix } from "../cards/card-front-prefix"

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}

export function ReviewSequentialPage() {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [cardId, setCardId] = useState<string | undefined>(undefined)
  const [move, setMove] = useState<"resume" | "next" | "prev" | "first" | "current">("resume")
  const [revealed, setRevealed] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  const query = trpc.review.sequential.useQuery(
    { deckId, cardId, move },
    { refetchOnWindowFocus: false, staleTime: 0 }
  )

  const data = query.data
  const card = data?.card ?? null

  // Once a move resolves to a card, anchor on it (move → "current") so an
  // identity refetch returns the same card instead of advancing again.
  useEffect(() => {
    if (card && move !== "current") {
      setCardId(card.id)
      setMove("current")
    }
  }, [card, move])

  useEffect(() => {
    setRevealed(false)
  }, [card?.id])

  const goTo = (nextMove: "next" | "prev" | "first") => {
    setMove(nextMove)
  }

  const advance = trpc.review.advance.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
      goTo("next")
    },
  })

  const complete = trpc.review.complete.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
      utils.decks.upcomingDueCounts.invalidate({ id: deckId })
      utils.decks.reviewStats.invalidate({ id: deckId })
      goTo("next")
    },
  })

  if (query.isLoading) return <p></p>

  if (!card) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Reached the end</h1>
        <p className="text-sm text-muted-foreground">You have gone through every card.</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => goTo("first")}>Restart</Button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline" }))}
            onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
          >
            Back to deck
          </button>
        </div>
      </div>
    )
  }

  const prev = FIXATION_LEVELS.includes(card.subject.fixationLevel as FixationLevel)
    ? (card.subject.fixationLevel as FixationLevel)
    : "1"
  const options = buttonsForPrevious(prev)
  const promptSource = displayFrontWithGeneratedTagPrefix(card.front, card.tags)
  const pending = advance.isPending || complete.isPending

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        subtitle={card.subject.subject}
        onBack={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
        actions={
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous card"
              disabled={!data?.hasPrev || pending}
              onClick={() => goTo("prev")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Restart"
              onClick={() => setRestartOpen(true)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit card"
              onClick={() =>
                navigate({
                  to: "/decks/$deckId/cards/$cardId/edit",
                  params: { deckId, cardId: card.id },
                  search: { returnToReviewCard: true, reviewMode: "normal" },
                })
              }
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div key={card.id} className="contents [&>*]:animate-card-in">
        <Card>
          <CardContent className="min-h-[8rem] p-4">
            <MarkdownView source={promptSource} />
          </CardContent>
        </Card>
      </div>

      {revealed ? (
        <>
          <Card className="animate-reveal">
            <CardContent className="min-h-[8rem] p-4">
              <MarkdownView source={card.back} />
            </CardContent>
          </Card>
          {data?.isLastInSubject ? (
            <div className="mt-auto grid grid-cols-4 gap-2 animate-reveal">
              {options.map((lvl: FixationLevel) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={pending}
                  onClick={() => complete.mutate({ cardId: card.id, chosenLevel: lvl })}
                  aria-label={`${lvl} - ${COOLDOWN_LABEL[lvl]}`}
                  className={cn(
                    "flex h-20 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50",
                    LEVEL_COLOR[lvl]
                  )}
                >
                  <span className="text-3xl leading-none">{FIXATION_EMOJI[lvl]}</span>
                  <span className="text-sm opacity-90">{COOLDOWN_LABEL[lvl]}</span>
                </button>
              ))}
            </div>
          ) : (
            <Button
              className="mt-auto w-full animate-reveal gap-1.5"
              disabled={pending}
              onClick={() => advance.mutate({ cardId: card.id })}
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </>
      ) : (
        <Button className="mt-auto w-full" onClick={() => setRevealed(true)}>
          Reveal
        </Button>
      )}

      <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart this deck?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Jump back to the first card. Your progress and stats are not changed.
          </p>
          <div className="mt-4 flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="flex-1"
              onClick={() => {
                setRestartOpen(false)
                goTo("first")
              }}
            >
              Restart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
