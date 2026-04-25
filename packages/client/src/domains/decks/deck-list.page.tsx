import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"

export function DeckListPage() {
  const utils = trpc.useUtils()
  const decks = trpc.decks.list.useQuery()
  const create = trpc.decks.create.useMutation({
    onSuccess: () => utils.decks.list.invalidate(),
  })
  const [name, setName] = useState("")

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Your decks</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          create.mutate({ name: name.trim() }, { onSuccess: () => setName("") })
        }}
      >
        <Input placeholder="New deck name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={create.isPending}>
          Add
        </Button>
      </form>
      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}

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
        <p className="text-sm text-muted-foreground">No decks yet — create one above.</p>
      )}
    </div>
  )
}
