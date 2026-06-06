import { useCallback, useEffect, useRef, useState } from "react"
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
import { Button, buttonVariants } from "../../ui/Button"
import { Card, CardContent } from "../../ui/Card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../Lib/Utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog"
import { generatedTagPrefix } from "../Cards/CardFrontPrefix"

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}

export function ReviewSequentialPage({
  initialCardId,
  initialSubjectId,
}: {
  initialCardId?: string
  initialSubjectId?: string
} = {}) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  type SeqResult = Awaited<ReturnType<typeof utils.review.sequential.fetch>>
  const [result, setResult] = useState<SeqResult | null>(null)
  const [ready, setReady] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  // Forward prefetch: while a card is shown, fetch its "next" in the background
  // so advancing is instant. Keyed by the card it was computed from; consumed
  // once on the matching "next" move. Backward moves intentionally not cached.
  const prefetchedNext = useRef<{ forCardId: string; promise: Promise<SeqResult | null> } | null>(
    null
  )

  // Navigation is imperative: each move fetches the target card and replaces the
  // displayed result. This keeps a single source of truth (no query-key churn)
  // so "first" always lands on the first card and prev/next traverse subjects.
  const go = useCallback(
    async (
      move: "resume" | "next" | "prev" | "first" | "subjectFirst" | "current" | "subjectStart",
      cardId?: string,
      subjectId?: string
    ) => {
      setNavigating(true)
      try {
        const pf = prefetchedNext.current
        prefetchedNext.current = null
        let res: SeqResult | null = null
        if (move === "next" && cardId && pf && pf.forCardId === cardId) {
          res = await pf.promise
        }
        if (!res) {
          res = await utils.review.sequential.fetch(
            { deckId, cardId, subjectId, move },
            { staleTime: 0 }
          )
        }
        setResult(res)
        setRevealed(false)
        setReady(true)
      } finally {
        setNavigating(false)
      }
    },
    [deckId, utils]
  )

  const prefetchNext = useCallback(
    (cardId: string) => {
      prefetchedNext.current = {
        forCardId: cardId,
        promise: utils.review.sequential
          .fetch({ deckId, cardId, move: "next" }, { staleTime: 30_000 })
          .catch(() => null),
      }
    },
    [deckId, utils]
  )

  useEffect(() => {
    if (initialCardId) go("current", initialCardId)
    else if (initialSubjectId) go("subjectStart", undefined, initialSubjectId)
    else go("resume")
  }, [go, initialCardId, initialSubjectId])

  const card = result?.card ?? null

  useEffect(() => {
    if (card?.id) prefetchNext(card.id)
  }, [card?.id, prefetchNext])

  // The mutations run in the background (fire-and-forget). Sequential "next" is
  // determined purely by static card/subject ordering, never by lastSeenAt or
  // cooldown, so the prefetched next card is valid before advance/complete
  // finishes. Navigating immediately (not from onSuccess) removes the mutation
  // round-trip from the perceived load time. onSuccess only refreshes deck stats.
  const advance = trpc.review.advance.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
    },
  })

  const complete = trpc.review.complete.useMutation({
    onSuccess: () => {
      utils.decks.get.invalidate({ id: deckId })
      utils.decks.upcomingDueCounts.invalidate({ id: deckId })
      utils.decks.reviewStats.invalidate({ id: deckId })
    },
  })

  const advanceNext = useCallback(
    (cardId: string) => {
      advance.mutate({ cardId })
      go("next", cardId)
    },
    [advance, go]
  )

  const completeNext = useCallback(
    (cardId: string, chosenLevel: FixationLevel) => {
      complete.mutate({ cardId, chosenLevel })
      go("next", cardId)
    },
    [complete, go]
  )

  // "Repeat" replaces the level-1 button: same level-1 update, but jumps back to
  // the first card of the subject to study it again instead of advancing.
  const repeatSubject = useCallback(
    (cardId: string) => {
      complete.mutate({ cardId, chosenLevel: "1" })
      go("subjectFirst", cardId)
    },
    [complete, go]
  )

  if (!ready) return <p></p>

  if (!card) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Reached the end</h1>
        <p className="text-sm text-muted-foreground">You have gone through every card.</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => go("first")}>Restart</Button>
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
  const promptSource = card.front
  const promptPrefix = generatedTagPrefix(card.tags)
  // Only gate on navigation. Mutations run in the background; gating on their
  // isPending would re-block consecutive fast advances.
  const pending = navigating

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
              disabled={!result?.hasPrev || pending}
              onClick={() => go("prev", card.id)}
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
            <MarkdownView source={promptSource} prefix={promptPrefix} />
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
          {result?.isLastInSubject ? (
            <div className="mt-auto grid grid-cols-4 gap-2 animate-reveal">
              {options.map((lvl: FixationLevel) =>
                lvl === "1" ? (
                  <button
                    key={lvl}
                    type="button"
                    disabled={pending}
                    onClick={() => repeatSubject(card.id)}
                    aria-label="Repeat subject from first card"
                    className={cn(
                      "flex h-20 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50",
                      LEVEL_COLOR["1"]
                    )}
                  >
                    <RotateCcw className="h-7 w-7" />
                    <span className="text-sm opacity-90">Repeat</span>
                  </button>
                ) : (
                  <button
                    key={lvl}
                    type="button"
                    disabled={pending}
                    onClick={() => completeNext(card.id, lvl)}
                    aria-label={`${lvl} - ${COOLDOWN_LABEL[lvl]}`}
                    className={cn(
                      "flex h-20 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50",
                      LEVEL_COLOR[lvl]
                    )}
                  >
                    <span className="text-3xl leading-none">{FIXATION_EMOJI[lvl]}</span>
                    <span className="text-sm opacity-90">{COOLDOWN_LABEL[lvl]}</span>
                  </button>
                )
              )}
            </div>
          ) : (
            <Button
              className="mt-auto w-full animate-reveal gap-1.5"
              disabled={pending}
              onClick={() => advanceNext(card.id)}
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
                go("first")
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
