import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import {
  buttonsForPrevious,
  COOLDOWN_LABEL,
  FIXATION_EMOJI,
  FIXATION_LEVELS,
  type FixationLevel,
} from "@cards/shared/fixation"
import { type ReviewMode } from "@cards/shared"
import { PageHeader } from "../../components/AppShell"
import { Card, CardContent } from "../../ui/Card"
import { buttonVariants, Button } from "../../ui/Button"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../Lib/Utils"
import { generatedTagPrefix } from "../Cards/CardFrontPrefix"
import { useOfflineReview } from "../Offline/useOfflineReview"
import { getSnapshot } from "../Offline/db"
import { OfflineSequentialReviewPage } from "./OfflineSequentialReviewPage"

type OfflineReviewProps = {
  mode: ReviewMode
  initialSubjectId?: string
  initialCardId?: string
}

// Sequential decks use the ordered offline navigator in normal mode; everything else (free review,
// non-sequential decks) uses the standard offline picker.
export function OfflineReviewPage(props: OfflineReviewProps) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const [sequential, setSequential] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void getSnapshot(deckId).then((s) => {
      if (!cancelled) setSequential(Boolean(s?.deck.sequentialEnabled))
    })
    return () => {
      cancelled = true
    }
  }, [deckId])

  if (sequential === null) return <p></p>
  if (sequential && props.mode === "normal") {
    return (
      <OfflineSequentialReviewPage
        initialCardId={props.initialCardId}
        initialSubjectId={props.initialSubjectId}
      />
    )
  }
  return <OfflineStandardReviewPage {...props} />
}

const LEVEL_COLOR: Record<FixationLevel, string> = {
  "1": "bg-red-500 hover:bg-red-600 text-white",
  "2": "bg-orange-500 hover:bg-orange-600 text-white",
  "3": "bg-yellow-400 hover:bg-yellow-500 text-black",
  "4": "bg-lime-500 hover:bg-lime-600 text-white",
  "5": "bg-green-600 hover:bg-green-700 text-white",
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}
const NEW_SUBJECT_EMOJI_WINDOW_MS = 12 * 60 * 60 * 1000

// Offline counterpart to ReviewPage's standard path: same reveal/level UI, but the next card and
// the review effects are computed locally from the deck snapshot. Speech recognition and card
// editing are disabled offline.
function OfflineStandardReviewPage({ mode, initialSubjectId, initialCardId }: OfflineReviewProps) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const [revealed, setRevealed] = useState(false)
  const { loading, card, inverse, completing, complete } = useOfflineReview(
    deckId,
    mode,
    initialSubjectId,
    initialCardId
  )

  useEffect(() => {
    setRevealed(false)
  }, [card?.id])

  if (loading) return <p></p>

  if (!card) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">All caught up</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "normal" ? "No cards are due offline." : "No cards in this deck."}
        </p>
        <div className="flex flex-col gap-2">
          {mode === "normal" && (
            <Link
              to="/decks/$deckId/review/free"
              params={{ deckId }}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Free review (ignore cooldowns)
            </Link>
          )}
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

  const prev = FIXATION_LEVELS.includes(card.subject.fixationLevel as FixationLevel)
    ? (card.subject.fixationLevel as FixationLevel)
    : "1"
  const options = buttonsForPrevious(prev)
  const firstSeenAtMs = card.subject.firstSeenAt
    ? new Date(card.subject.firstSeenAt).getTime()
    : null
  const showNewSubjectEmoji =
    card.subject.lastSeenAt === null ||
    (firstSeenAtMs !== null &&
      Number.isFinite(firstSeenAtMs) &&
      Date.now() - firstSeenAtMs < NEW_SUBJECT_EMOJI_WINDOW_MS)
  const promptTags = showNewSubjectEmoji ? [...card.tags, "review:never-seen"] : card.tags
  const promptPrefix = generatedTagPrefix(promptTags)
  const promptSource = inverse ? card.back : card.front
  const revealedSource = inverse ? card.front : card.back
  const subtitle = inverse
    ? mode === "free"
      ? "Free inverse review · offline"
      : "Inverse review · offline"
    : mode === "free"
      ? "Free review · offline"
      : "Offline review"

  return (
    <div className="flex flex-1 flex-col gap-3 pb-3">
      <PageHeader
        subtitle={subtitle}
        onBack={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
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
              <MarkdownView source={revealedSource} />
            </CardContent>
          </Card>
          {inverse ? (
            <Button
              className="mt-auto w-full animate-reveal gap-1.5"
              disabled={completing}
              onClick={() => void complete({ inverse: true })}
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="mt-auto grid grid-cols-4 gap-2 animate-reveal">
              {options.map((lvl: FixationLevel) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={completing}
                  onClick={() => void complete({ chosenLevel: lvl })}
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
          )}
        </>
      ) : (
        <Button className="mt-auto w-full" onClick={() => setRevealed(true)}>
          Reveal
        </Button>
      )}
    </div>
  )
}
