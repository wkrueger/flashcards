import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Check, Flame, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { handleTRPCError, trpc } from "../../infra/trpc"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { cn } from "../../lib/utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { LanguageSelect } from "./language-select"
import { MenuItem, PageHeader } from "../../components/AppShell"

export function DeckDetailPage() {
  const { deckId } = useParams({ from: "/(app)/decks/$deckId" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const deck = trpc.decks.get.useQuery({ id: deckId })
  const upcoming = trpc.decks.upcomingDueCounts.useQuery({ id: deckId })
  const randomSubjects = trpc.decks.randomSubjects.useQuery({ id: deckId })
  const reviewStats = trpc.decks.reviewStats.useQuery({ id: deckId })
  const dueCount = deck.data ? deck.data.wordCount - deck.data.cooldownCount : 0

  const deleteDeck = trpc.decks.delete.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      navigate({ to: "/" })
    },
  })

  const updateDeck = trpc.decks.update.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      utils.decks.get.invalidate({ id: deckId })
      setEditOpen(false)
    },
  })

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editFrontLang, setEditFrontLang] = useState("")
  const [editBackLang, setEditBackLang] = useState("")
  const [inverseReviewEnabled, setInverseReviewEnabled] = useState(false)

  useEffect(() => {
    if (editOpen && deck.data) {
      setEditName(deck.data.name)
      setEditFrontLang(
        deck.data.defaultFrontLanguageId ? String(deck.data.defaultFrontLanguageId) : ""
      )
      setEditBackLang(
        deck.data.defaultBackLanguageId ? String(deck.data.defaultBackLanguageId) : ""
      )
    }
  }, [editOpen, deck.data])

  useEffect(() => {
    if (deck.data) {
      setInverseReviewEnabled(deck.data.inverseReviewEnabled)
    }
  }, [deck.data])

  const updateInverseReview = trpc.decks.update.useMutation({
    onMutate: async (input) => {
      await utils.decks.get.cancel({ id: deckId })
      const previousDeck = utils.decks.get.getData({ id: deckId })
      utils.decks.get.setData({ id: deckId }, (current) =>
        current
          ? {
              ...current,
              inverseReviewEnabled: input.inverseReviewEnabled ?? current.inverseReviewEnabled,
            }
          : current
      )
      return { previousDeck }
    },
    onError: (error, _input, context) => {
      if (context?.previousDeck) {
        utils.decks.get.setData({ id: deckId }, context.previousDeck)
        setInverseReviewEnabled(context.previousDeck.inverseReviewEnabled)
      }
      handleTRPCError(error)
    },
    onSuccess: () => {
      utils.decks.list.invalidate()
      utils.review.next.invalidate()
    },
    onSettled: () => {
      utils.decks.get.invalidate({ id: deckId })
    },
  })

  useEffect(() => {
    if (!deck.data) return
    if (inverseReviewEnabled === deck.data.inverseReviewEnabled) return

    const timeoutId = window.setTimeout(() => {
      updateInverseReview.mutate({ id: deckId, inverseReviewEnabled })
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [deck.data, deckId, inverseReviewEnabled, updateInverseReview])

  const editSameLanguage = !!editFrontLang && !!editBackLang && editFrontLang === editBackLang

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title={deck.data?.name ?? ""}
        onBack={() => navigate({ to: "/" })}
        actions={
          <>
            <Link
              to="/decks/$deckId/cards/generate"
              params={{ deckId }}
              aria-label="New word from template"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
            >
              <Sparkles className="h-4 w-4" />
              Add word
            </Link>
          </>
        }
        menuItems={
          <>
            <MenuItem
              icon={<Plus className="h-[18px] w-[18px]" />}
              onSelect={() => navigate({ to: "/decks/$deckId/cards/new", params: { deckId } })}
            >
              Add card
            </MenuItem>
            <MenuItem
              icon={<Pencil className="h-[18px] w-[18px]" />}
              onSelect={() => setEditOpen(true)}
            >
              Edit deck
            </MenuItem>
            <MenuItem
              icon={<Trash2 className="h-[18px] w-[18px]" />}
              destructive
              onSelect={() => setDeleteOpen(true)}
            >
              Delete deck
            </MenuItem>
          </>
        }
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit deck</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!editName.trim() || editSameLanguage) return
              updateDeck.mutate({
                id: deckId,
                name: editName.trim(),
                defaultFrontLanguageId: editFrontLang ? Number(editFrontLang) : null,
                defaultBackLanguageId: editBackLang ? Number(editBackLang) : null,
              })
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="edit-deck-name">Name</Label>
              <Input
                id="edit-deck-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Translating from language (optional)</Label>
              <LanguageSelect
                value={editFrontLang}
                onChange={setEditFrontLang}
                disabledValue={editBackLang}
              />
            </div>
            <div className="space-y-1">
              <Label>Study language (optional)</Label>
              <LanguageSelect
                value={editBackLang}
                onChange={setEditBackLang}
                disabledValue={editFrontLang}
              />
              {editSameLanguage && (
                <p className="text-sm text-destructive">Languages must be different.</p>
              )}
            </div>
            {updateDeck.error && (
              <p className="text-sm text-destructive">{updateDeck.error.message}</p>
            )}
            <div className="mt-4 flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                className="flex-1"
                disabled={updateDeck.isPending || editSameLanguage}
              >
                {updateDeck.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deck.data?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the deck, all its cards, and any subjects that have no
            cards in other decks. This cannot be undone.
          </p>
          {deleteDeck.error && (
            <p className="text-sm text-destructive">{deleteDeck.error.message}</p>
          )}
          <div className="mt-4 flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteDeck.isPending}
              onClick={() => deleteDeck.mutate({ id: deckId })}
            >
              {deleteDeck.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {deck.data && (
        <>
          <div className="flex items-start gap-4">
            <TopStat label="cards" value={deck.data.cardCount} />
            <TopStat label="words" value={deck.data.wordCount} />
            <div className="flex-1" />
            <TopStat label={["due in", "24h"]} value={upcoming.data?.in24h} />
            <TopStat label={["due in", "2 days"]} value={upcoming.data?.in2d} />
            <TopStat label={["due in", "1 week"]} value={upcoming.data?.in1w} />
          </div>

          <div className="flex flex-col gap-2">
            {dueCount > 0 ? (
              <Link
                to="/decks/$deckId/review"
                params={{ deckId }}
                className={cn(buttonVariants({ variant: "default" }))}
              >
                Review {dueCount} due
              </Link>
            ) : (
              <Link
                to="/decks/$deckId/review/free"
                params={{ deckId }}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Free review (no cards due)
              </Link>
            )}
          </div>

          {reviewStats.data && <ReviewStatsChart data={reviewStats.data} />}

          {randomSubjects.data && randomSubjects.data.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Sample words
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {randomSubjects.data.map((s) => (
                  <Link
                    key={s.id}
                    to="/decks/$deckId/review/subjects/$subjectId"
                    params={{ deckId, subjectId: s.id }}
                    className="flex min-h-[3rem] items-center justify-center rounded-md border bg-card px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-accent/40"
                  >
                    <span className="line-clamp-2 break-words">{s.subject}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-4">
            <label className="flex cursor-pointer items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40">
              <input
                type="checkbox"
                checked={inverseReviewEnabled}
                onChange={(e) => setInverseReviewEnabled(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground"
              >
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <span>Allow inverse mode</span>
                  {updateInverseReview.isPending && (
                    <LoaderCircle className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Occasionally review these cards back-to-front.
                </p>
              </div>
            </label>
          </div>
        </>
      )}
    </div>
  )
}

function TopStat({
  label,
  value,
}: {
  label: string | [string, string]
  value: number | undefined
}) {
  return (
    <div className="max-w-12 text-center">
      <p className="text-xl font-semibold">{value ?? "–"}</p>
      <p className="text-xs text-muted-foreground">
        {Array.isArray(label) ? (
          <>
            {label[0]}
            <br />
            {label[1]}
          </>
        ) : (
          label
        )}
      </p>
    </div>
  )
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatCardMinutes(minutes: number) {
  if (minutes <= 0) return "0"
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function formatCardsPerDay(cardCount: number, cardMinutes: number) {
  if (cardCount <= 0 || cardMinutes <= 0) return ""
  const days = cardMinutes / (24 * 60)
  return `${(cardCount / days).toFixed(1)}x`
}

function ReviewStatsChart({
  data,
}: {
  data: { date: string | Date; cardMinutes: number; cardCount: number }[]
}) {
  const max = Math.max(1, ...data.map((d) => d.cardMinutes))
  return (
    <Card
      className="relative overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(168deg, hsl(28 92% 56% / 0.18) 0%, hsl(28 92% 56% / 0.18) 8%, transparent 22%)",
      }}
    >
      <Flame
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-4 h-40 w-40 rotate-[18deg] opacity-25 dark:opacity-30"
        style={{ color: "hsl(28 92% 56%)" }}
      />
      <CardContent className="relative space-y-2 p-3">
        <h2
          className="text-sm"
          style={{
            fontFamily: '"Quicksand", system-ui, sans-serif',
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "hsl(28 92% 56%)",
          }}
        >
          Card x time
        </h2>
        <div className="flex h-24 items-stretch gap-2">
          {data.map((d) => {
            const date = new Date(d.date)
            const heightPct = (d.cardMinutes / max) * 100
            const ratioLabel = formatCardsPerDay(d.cardCount, d.cardMinutes)
            const hasRatioLabel = ratioLabel.length > 0
            const showRatioInside = hasRatioLabel && heightPct >= 38
            return (
              <div
                key={date.toISOString()}
                className="grid h-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-1"
              >
                <div className="space-y-1">
                  <span className="block text-center text-[10px] font-medium leading-none text-muted-foreground">
                    {d.cardMinutes > 0 ? formatCardMinutes(d.cardMinutes) : ""}
                  </span>
                  {hasRatioLabel && !showRatioInside && (
                    <span className="block text-center text-[9px] font-medium leading-none text-muted-foreground">
                      {ratioLabel}
                    </span>
                  )}
                </div>
                <div className="flex min-h-0 w-full items-end">
                  <div
                    className="relative w-full rounded-t transition-[height]"
                    style={{
                      backgroundColor: "hsl(28 92% 56%)",
                      height: `${heightPct}%`,
                      minHeight: d.cardMinutes > 0 ? "2px" : "0",
                    }}
                  >
                    {showRatioInside && (
                      <span className="absolute inset-x-0 top-1 text-center text-[9px] font-semibold leading-none text-white/90">
                        {ratioLabel}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-center text-[10px] leading-none text-muted-foreground">
                  {DAY_LABELS[date.getUTCDay()]}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
