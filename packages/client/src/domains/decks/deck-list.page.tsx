import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../../ui/dialog"
import { PageHeader } from "../../components/AppShell"

export function DeckListPage() {
  const utils = trpc.useUtils()
  const decks = trpc.decks.list.useQuery()
  const create = trpc.decks.create.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      setName("")
      setOpen(false)
    },
  })
  const [name, setName] = useState("")
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Your decks"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="New deck">
                <Plus className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New deck</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim()) return
                  create.mutate({ name: name.trim() })
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="deck-name">Name</Label>
                  <Input
                    id="deck-name"
                    placeholder="e.g. German A1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
                <Button type="submit" disabled={create.isPending} className="w-full">
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {decks.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : decks.data && decks.data.length > 0 ? (
        <ul className="space-y-2">
          {decks.data.map((d) => (
            <li key={d.id}>
              <Link
                to="/decks/$deckId"
                params={{ deckId: d.id }}
                className="flex items-center justify-between rounded-md border p-3 hover:bg-accent"
              >
                <span className="font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.cardCount} cards</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No decks yet — create your first one.</p>
      )}
    </div>
  )
}
