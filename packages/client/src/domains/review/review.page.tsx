import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowRight, Pencil } from "lucide-react"
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
  "6": "bg-emerald-700 hover:bg-emerald-800 text-white",
}
const NEW_SUBJECT_EMOJI_WINDOW_MS = 12 * 60 * 60 * 1000
import { trpc } from "../../infra/trpc"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { MarkdownView } from "../../components/MarkdownView"
import { cn } from "../../lib/utils"
import {
  displayFrontWithGeneratedTagPrefix,
  displayWithGeneratedTagPrefix,
} from "../cards/card-front-prefix"
import { SpeechRecognitionCard, type SpeechRecognitionCardHandle } from "./speech-recognition-card"

export function ReviewPage({
  mode,
  initialSubjectId,
  initialCardId,
}: {
  mode: ReviewMode
  initialSubjectId?: string
  initialCardId?: string
}) {
  const { deckId } = useParams({ strict: false }) as { deckId: string }
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [revealed, setRevealed] = useState(false)
  const [speechTranscript, setSpeechTranscript] = useState("")
  const [initialConsumed, setInitialConsumed] = useState(false)
  const speechRecognitionRef = useRef<SpeechRecognitionCardHandle>(null)
  const specificCardId = initialConsumed ? undefined : initialCardId
  const subjectId = initialConsumed || specificCardId ? undefined : initialSubjectId
  const routeScopeKey = `${deckId}:${mode}:${initialSubjectId ?? ""}:${initialCardId ?? ""}`
  const queryScopeKey = `${deckId}:${mode}:${subjectId ?? ""}:${specificCardId ?? ""}`
  const [enteredQueryScopeAt, setEnteredQueryScopeAt] = useState(() => Date.now())

  const deck = trpc.decks.get.useQuery(
    { id: deckId },
    { refetchOnWindowFocus: false, refetchOnMount: false, staleTime: 5 * 60 * 1000 }
  )
  const next = trpc.review.next.useQuery(
    { deckId, mode, subjectId, cardId: specificCardId },
    { refetchOnWindowFocus: false, refetchOnMount: "always", staleTime: 0 }
  )
  const currentCardId = next.data?.card?.id
  const hasFreshCardForScope = next.dataUpdatedAt >= enteredQueryScopeAt

  useEffect(() => {
    setEnteredQueryScopeAt(Date.now())
  }, [queryScopeKey])

  useEffect(() => {
    setRevealed(false)
    setSpeechTranscript("")
    setInitialConsumed(false)
  }, [routeScopeKey])

  useEffect(() => {
    setSpeechTranscript("")
  }, [currentCardId])

  const complete = trpc.review.complete.useMutation({
    onMutate: () => {
      if (!currentCardId) return
      if ((initialSubjectId || initialCardId) && !initialConsumed) return
      const prefetched = utils.review.next.getData({
        deckId,
        mode,
        subjectId,
        excludeCardId: currentCardId,
      })
      if (prefetched) {
        utils.review.next.setData({ deckId, mode, subjectId }, prefetched)
        setRevealed(false)
        setSpeechTranscript("")
      }
    },
    onSuccess: async (_result, variables) => {
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.get.invalidate({ id: deckId })
      utils.decks.upcomingDueCounts.invalidate({ id: deckId })
      utils.decks.reviewStats.invalidate({ id: deckId })

      if ((initialSubjectId || initialCardId) && !initialConsumed) {
        const freshNext = await utils.review.next.fetch({
          deckId,
          mode,
          subjectId: undefined,
          excludeCardId: variables.cardId,
        })
        utils.review.next.setData({ deckId, mode, subjectId: undefined }, freshNext)
        setRevealed(false)
        setSpeechTranscript("")
        setInitialConsumed(true)
        return
      }

      setRevealed(false)
      setSpeechTranscript("")

      const prefetched = utils.review.next.getData({
        deckId,
        mode,
        subjectId,
        excludeCardId: variables.cardId,
      })

      if (prefetched) {
        utils.review.next.setData({ deckId, mode, subjectId }, prefetched)
        return
      }

      const freshNext = await utils.review.next.fetch({
        deckId,
        mode,
        subjectId,
        excludeCardId: variables.cardId,
      })
      utils.review.next.setData({ deckId, mode, subjectId }, freshNext)
    },
  })

  useEffect(() => {
    if (!currentCardId) return
    if (complete.isPending) return
    if ((initialSubjectId || initialCardId) && !initialConsumed) return
    utils.review.next.prefetch({ deckId, mode, subjectId, excludeCardId: currentCardId })
  }, [
    currentCardId,
    deckId,
    mode,
    subjectId,
    utils,
    complete.isPending,
    initialSubjectId,
    initialCardId,
    initialConsumed,
  ])

  if (next.isLoading || (next.isFetching && !hasFreshCardForScope)) return <p></p>

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
  const inverse = next.data.inverse
  const prev = fixationLevelSchema.parse(card.subject.fixationLevel)
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
  const promptSource = inverse
    ? displayWithGeneratedTagPrefix(card.back, promptTags)
    : displayFrontWithGeneratedTagPrefix(card.front, promptTags)
  const revealedSource = inverse ? card.front : card.back
  const speechRecognitionLocale = deck.data?.speechRecognitionLocale ?? null
  const hasSpeechRecognitionLocale =
    typeof speechRecognitionLocale === "string" && speechRecognitionLocale.length > 0
  const showSpeechRecognitionCard =
    !inverse && Boolean(deck.data?.speechRecognitionEnabled) && hasSpeechRecognitionLocale
  const subtitle = subjectId
    ? inverse
      ? `Inverse review · ${card.subject.subject}`
      : `Subject review · ${card.subject.subject}`
    : inverse
      ? mode === "free"
        ? "Free inverse review"
        : "Inverse review"
      : mode === "free"
        ? "Free review"
        : undefined

  const speechRecognitionJsx =
    showSpeechRecognitionCard && speechRecognitionLocale ? (
      <SpeechRecognitionCard
        className="mt-auto"
        key={`${card.id}:${speechRecognitionLocale}`}
        ref={speechRecognitionRef}
        locale={speechRecognitionLocale}
        transcript={speechTranscript}
        onTranscriptChange={setSpeechTranscript}
      />
    ) : null

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        subtitle={subtitle}
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
                search: { returnToReviewCard: true, reviewMode: mode },
              })
            }
          >
            <Pencil className="h-4 w-4" />
          </Button>
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
              <MarkdownView source={revealedSource} />
            </CardContent>
          </Card>
          {inverse ? (
            <Button
              className="mt-auto w-full animate-reveal gap-1.5"
              disabled={complete.isPending}
              onClick={() => complete.mutate({ cardId: card.id, inverse: true })}
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              {speechRecognitionJsx}
              <div
                className={cn(
                  "grid grid-cols-4 gap-2 animate-reveal",
                  !(showSpeechRecognitionCard && speechRecognitionLocale) && "mt-auto"
                )}
              >
                {options.map((lvl: FixationLevel) => (
                  <button
                    key={lvl}
                    type="button"
                    disabled={complete.isPending}
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
            </>
          )}
        </>
      ) : (
        <>
          {speechRecognitionJsx}
          <Button
            className={cn(
              "w-full",
              !(showSpeechRecognitionCard && speechRecognitionLocale) && "mt-auto"
            )}
            onClick={() => {
              if (!inverse) speechRecognitionRef.current?.stopAndKeepTranscript()
              setRevealed(true)
            }}
          >
            Reveal
          </Button>
        </>
      )}
    </div>
  )
}
