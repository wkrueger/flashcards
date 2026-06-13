import { useEffect, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react"
import {
  buttonsForPrevious,
  COOLDOWN_LABEL,
  FIXATION_EMOJI,
  FIXATION_LEVELS,
  type FixationLevel,
} from "@cards/shared/fixation"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/Button"
import { Card, CardContent } from "../../ui/Card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../Lib/Utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog"
import { generatedTagPrefix } from "../Cards/CardFrontPrefix"
import { useOfflineSequential } from "../Offline/useOfflineSequential"

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}

// Offline counterpart to ReviewSequentialPage: same ordered next/prev/repeat/restart navigation,
// driven by the local snapshot. Editing is disabled offline; grades and advances are queued for sync.
export function OfflineSequentialReviewPage({
  initialCardId,
  initialSubjectId,
}: {
  initialCardId?: string
  initialSubjectId?: string
} = {}) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const [revealed, setRevealed] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const { ready, navigating, result, go, advanceNext, completeNext, repeatSubject } =
    useOfflineSequential(deckId, initialCardId, initialSubjectId)

  const card = result?.card ?? null
  useEffect(() => {
    setRevealed(false)
  }, [card?.id])

  if (!ready) return <p></p>

  if (!card) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Reached the end</h1>
        <p className="text-sm text-muted-foreground">You have gone through every card.</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => void go("first")}>Restart</Button>
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
  const promptPrefix = generatedTagPrefix(card.tags)
  const pending = navigating

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        subtitle={`${card.subject.subject} · offline`}
        onBack={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
        actions={
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous card"
              disabled={!result?.hasPrev || pending}
              onClick={() => void go("prev", card.id)}
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
          </div>
        }
      />

      <div key={card.id} className="contents [&>*]:animate-card-in">
        <Card>
          <CardContent className="min-h-[8rem] p-4">
            <MarkdownView source={card.front} prefix={promptPrefix} />
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
                    onClick={() => void repeatSubject(card.id)}
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
                    onClick={() => void completeNext(card.id, lvl)}
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
              onClick={() => void advanceNext(card.id)}
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
                void go("first")
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
