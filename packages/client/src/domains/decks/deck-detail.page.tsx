import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { Button, buttonVariants } from "../../ui/button"
import { cn } from "../../lib/utils"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { LanguageSelect } from "./language-select"
import { MenuItem, PageHeader } from "../../components/AppShell"

export function DeckDetailPage() {
  const { deckId } = useParams({ from: "/decks/$deckId" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const deck = trpc.decks.get.useQuery({ id: deckId })
  const next = trpc.review.next.useQuery({ deckId, mode: "normal" })
  const dueCount = next.data?.dueCount ?? 0

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

  const editSameLanguage =
    !!editFrontLang && !!editBackLang && editFrontLang === editBackLang

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title={deck.data?.name ?? "Deck"}
        onBack={() => navigate({ to: "/" })}
        actions={
          <>
            <Link
              to="/decks/$deckId/cards/new"
              params={{ deckId }}
              aria-label="New card"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
            >
              <Plus className="h-4 w-4" />
              Card
            </Link>
            <Link
              to="/decks/$deckId/cards/generate"
              params={{ deckId }}
              aria-label="New word from template"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
            >
              <Sparkles className="h-4 w-4" />
              Word
            </Link>
          </>
        }
        menuItems={
          <>
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
              <Label>Default front language (optional)</Label>
              <LanguageSelect
                value={editFrontLang}
                onChange={setEditFrontLang}
                disabledValue={editBackLang}
              />
            </div>
            <div className="space-y-1">
              <Label>Default back language (optional)</Label>
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

      <div className="flex gap-4">
        <div className="text-center">
          <p className="text-2xl font-semibold">{deck.data?.cardCount ?? "—"}</p>
          <p className="text-xs text-muted-foreground">cards</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold">{deck.data?.wordCount ?? "—"}</p>
          <p className="text-xs text-muted-foreground">words</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold">{deck.data?.cooldownCount ?? "—"}</p>
          <p className="text-xs text-muted-foreground">on cooldown</p>
        </div>
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
    </div>
  )
}
