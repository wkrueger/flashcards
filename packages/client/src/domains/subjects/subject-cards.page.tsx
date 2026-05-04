import { ChangeEvent, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { cn } from "../../lib/utils"
import { Button } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { MarkdownView } from "../../components/MarkdownViewLazy"
import { MenuItem, PageHeader } from "../../components/AppShell"
import { displayFrontWithGeneratedTagPrefix } from "../cards/card-front-prefix"

const TEMPLATE = "createPhrasesForWords"

function AutoGrowTextarea({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      rows={1}
      className="block w-full resize-none border-0 bg-transparent p-0 text-lg leading-7 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
    />
  )
}

interface SubjectCardData {
  id: string
  deckId: string
  front: string
  back: string
  genTemplate: string | null
  tags: string[]
}

export function SubjectCardsPage() {
  const { deckId, subjectId } = useParams({
    from: "/(app)/decks/$deckId/subjects/$subjectId",
  })
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const subject = trpc.subjects.get.useQuery({ id: subjectId })
  const deck = trpc.decks.get.useQuery({ id: deckId })

  const goToDeck = () => navigate({ to: "/decks/$deckId", params: { deckId } })

  const updateCard = trpc.cards.update.useMutation({
    onSuccess: () => {
      utils.subjects.get.invalidate({ id: subjectId })
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.review.next.invalidate()
    },
  })

  const deleteCard = trpc.cards.delete.useMutation({
    onSuccess: () => {
      utils.subjects.get.invalidate({ id: subjectId })
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.list.invalidate()
      utils.review.next.invalidate()
    },
  })

  const generate = trpc.cardTemplate.generatePreviews.useMutation()

  const deleteSubject = trpc.subjects.delete.useMutation({
    onSuccess: () => {
      goToDeck()
      utils.subjects.autocomplete.invalidate()
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.list.invalidate()
      utils.decks.get.invalidate({ id: deckId })
      utils.review.next.invalidate()
    },
  })

  const renameSubject = trpc.subjects.rename.useMutation({
    onSuccess: () => {
      utils.subjects.get.invalidate({ id: subjectId })
      utils.subjects.autocomplete.invalidate()
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.review.next.invalidate()
      setRenameOpen(false)
    },
  })

  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")

  useEffect(() => {
    if (renameOpen && subject.data) setRenameValue(subject.data.subject)
  }, [renameOpen, subject.data])

  const regenerate = async (card: SubjectCardData) => {
    if (!subject.data || !deck.data) return
    if (!deck.data.defaultFrontLanguageId || !deck.data.defaultBackLanguageId) {
      setActionError("Set the deck's default languages before regenerating cards.")
      return
    }
    setActionError(null)
    setRegeneratingId(card.id)
    try {
      const result = await generate.mutateAsync({
        template: TEMPLATE,
        frontLanguageId: deck.data.defaultFrontLanguageId,
        backLanguageId: deck.data.defaultBackLanguageId,
        wordOrExpression: subject.data.subject,
        count: 1,
      })
      const generated = result.cards[0]
      if (!generated) throw new Error("No card returned.")
      await updateCard.mutateAsync({
        id: card.id,
        front: generated.front,
        back: generated.back,
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not regenerate card.")
    } finally {
      setRegeneratingId(null)
    }
  }

  const removeCard = (card: SubjectCardData) => {
    if (!confirm("Delete this card?")) return
    setActionError(null)
    deleteCard.mutate({ id: card.id })
  }

  const saveCard = async (card: SubjectCardData, front: string, back: string) => {
    setActionError(null)
    try {
      await updateCard.mutateAsync({ id: card.id, front, back })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save card.")
      throw error
    }
  }

  if (subject.isLoading) return <p>Loading…</p>
  if (!subject.data) return <p>Not found</p>

  const cards = subject.data.cards
  const actionsDisabled = regeneratingId !== null || updateCard.isPending || deleteCard.isPending

  return (
    <div className="flex flex-1 flex-col gap-3">
      <PageHeader
        title={subject.data.subject}
        onBack={goToDeck}
        menuItems={
          <>
            <MenuItem
              icon={<Pencil className="h-[18px] w-[18px]" />}
              onSelect={() => setRenameOpen(true)}
            >
              Rename subject
            </MenuItem>
            <MenuItem
              icon={<Trash2 className="h-[18px] w-[18px]" />}
              destructive
              onSelect={() => setDeleteOpen(true)}
            >
              Delete subject
            </MenuItem>
          </>
        }
      />

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cards in this subject.</p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.id}>
              <SubjectCardItem
                card={card}
                isRegenerating={regeneratingId === card.id}
                actionsDisabled={actionsDisabled}
                onRegenerate={() => regenerate(card)}
                onRemove={() => removeCard(card)}
                onSave={(front, back) => saveCard(card, front, back)}
              />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename subject</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const next = renameValue.trim()
              if (!next || next === subject.data?.subject) return
              renameSubject.mutate({ id: subjectId, subject: next })
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="rename-subject">Subject name</Label>
              <Input
                id="rename-subject"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
            </div>
            {renameSubject.error && (
              <p className="text-sm text-destructive">{renameSubject.error.message}</p>
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
                disabled={
                  renameSubject.isPending ||
                  !renameValue.trim() ||
                  renameValue.trim() === subject.data.subject
                }
              >
                {renameSubject.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{subject.data.subject}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the subject and all {cards.length}{" "}
            {cards.length === 1 ? "card" : "cards"} associated with it. This cannot be undone.
          </p>
          {deleteSubject.error && (
            <p className="text-sm text-destructive">{deleteSubject.error.message}</p>
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
              disabled={deleteSubject.isPending}
              onClick={() => deleteSubject.mutate({ id: subjectId })}
            >
              {deleteSubject.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SubjectCardItem({
  card,
  isRegenerating,
  actionsDisabled,
  onRegenerate,
  onRemove,
  onSave,
}: {
  card: SubjectCardData
  isRegenerating: boolean
  actionsDisabled: boolean
  onRegenerate: () => void
  onRemove: () => void
  onSave: (front: string, back: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draftFront, setDraftFront] = useState(card.front)
  const [draftBack, setDraftBack] = useState(card.back)

  useEffect(() => {
    if (!editing) {
      setDraftFront(card.front)
      setDraftBack(card.back)
    }
  }, [card.front, card.back, editing])

  const startEditing = () => {
    setDraftFront(card.front)
    setDraftBack(card.back)
    setEditing(true)
  }

  const cancelEditing = () => {
    setDraftFront(card.front)
    setDraftBack(card.back)
    setEditing(false)
  }

  const confirmEditing = async () => {
    const front = draftFront.trim()
    const back = draftBack.trim()
    if (!front || !back) return
    try {
      await onSave(front, back)
      setEditing(false)
    } catch {
      // error surfaced by parent
    }
  }

  const canRegenerate = card.genTemplate !== null

  return (
    <Card className={isRegenerating ? "opacity-50" : ""}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Front</p>
              {editing ? (
                <AutoGrowTextarea
                  value={draftFront}
                  onChange={(event) => setDraftFront(event.target.value)}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={startEditing}
                >
                  <MarkdownView
                    source={displayFrontWithGeneratedTagPrefix(card.front, card.tags)}
                  />
                </button>
              )}
            </div>
            <div className="border-t pt-3">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Back</p>
              {editing ? (
                <AutoGrowTextarea
                  value={draftBack}
                  onChange={(event) => setDraftBack(event.target.value)}
                />
              ) : (
                <button
                  type="button"
                  className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={startEditing}
                >
                  <MarkdownView source={card.back} />
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1 pt-0.5">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Confirm edit"
                  disabled={!draftFront.trim() || !draftBack.trim()}
                  onClick={confirmEditing}
                >
                  <Check className="h-4 w-4 text-primary" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel edit"
                  onClick={cancelEditing}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                {canRegenerate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Regenerate card"
                    disabled={actionsDisabled}
                    onClick={onRegenerate}
                  >
                    <RefreshCw className={cn("h-4 w-4", isRegenerating && "animate-spin")} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove card"
                  disabled={actionsDisabled}
                  onClick={onRemove}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
