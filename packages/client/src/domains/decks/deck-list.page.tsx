import { Link, useNavigate } from "@tanstack/react-router"
import { FileDown, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { MenuItem, PageHeader } from "../../components/AppShell"
import { LightbulbIllustration } from "../../components/LightbulbIllustration"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { LanguageSelect } from "./language-select"

export function DeckListPage() {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const decks = trpc.decks.list.useQuery()
  const create = trpc.decks.create.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      setName("")
      setFrontLanguageId("")
      setBackLanguageId("")
      setOpen(false)
    },
  })
  const [name, setName] = useState("")
  const [frontLanguageId, setFrontLanguageId] = useState("")
  const [backLanguageId, setBackLanguageId] = useState("")
  const [open, setOpen] = useState(false)
  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    if (!decks.isLoading) return
    const id = setTimeout(() => setShowLoader(true), 1500)
    return () => clearTimeout(id)
  }, [decks.isLoading])

  const sameLanguage = !!frontLanguageId && !!backLanguageId && frontLanguageId === backLanguageId

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Your decks"
        actions={
          <>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-3">
                  <Plus className="h-4 w-4" />
                  New deck
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
                    if (!name.trim() || sameLanguage) return
                    create.mutate({
                      name: name.trim(),
                      defaultFrontLanguageId: frontLanguageId ? Number(frontLanguageId) : null,
                      defaultBackLanguageId: backLanguageId ? Number(backLanguageId) : null,
                    })
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
                  <div className="space-y-1">
                    <Label>Translating from language (optional)</Label>
                    <LanguageSelect
                      value={frontLanguageId}
                      onChange={setFrontLanguageId}
                      disabledValue={backLanguageId}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Study language (optional)</Label>
                    <LanguageSelect
                      value={backLanguageId}
                      onChange={setBackLanguageId}
                      disabledValue={frontLanguageId}
                    />
                    {sameLanguage && (
                      <p className="text-sm text-destructive">Languages must be different.</p>
                    )}
                  </div>
                  {create.error && (
                    <p className="text-sm text-destructive">{create.error.message}</p>
                  )}
                  <Button
                    type="submit"
                    disabled={create.isPending || sameLanguage}
                    className="w-full"
                  >
                    {create.isPending ? "Creating…" : "Create"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
        menuItems={
          <>
            <MenuItem
              onSelect={() => navigate({ to: "/imports/anki/new" })}
              icon={<FileDown className="h-[18px] w-[18px]" />}
              aria-label="Import Anki file"
            >
              Import Anki
            </MenuItem>
          </>
        }
      />

      {decks.isLoading ? (
        showLoader && (
          <div className="flex items-center justify-center gap-1.5 py-8">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
          </div>
        )
      ) : decks.data && decks.data.length > 0 ? (
        <ul className="animate-reveal space-y-2">
          {decks.data.map((d) => (
            <li key={d.id}>
              <Link
                to="/decks/$deckId"
                params={{ deckId: d.id }}
                className="flex min-h-[88px] items-center justify-between rounded-md border bg-card px-4 py-4 text-sm transition duration-150 hover:bg-accent active:bg-[hsl(var(--accent-strong))] active:opacity-80"
              >
                <span className="font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.dueCount} to do</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="animate-reveal text-sm text-muted-foreground">
          No decks yet — create your first one.
        </p>
      )}

      <Card
        className="relative mt-auto overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(168deg, hsl(var(--accent)) 0%, hsl(var(--accent)) 8%, transparent 22%)",
        }}
      >
        <LightbulbIllustration
          className="pointer-events-none absolute -right-16 -top-6 h-64 w-64 rotate-[18deg] opacity-25 dark:opacity-30"
          style={{ color: "hsl(var(--primary))" }}
        />
        <CardContent className="relative space-y-3 p-4">
          <h2
            className="app-gradient-text text-lg"
            style={{
              fontFamily: '"Quicksand", system-ui, sans-serif',
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            How to use
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Watch and read content in the target language</li>
            <li>Take note of new unknown words</li>
            <li>Create cards for the new words</li>
            <li>Practice the cards frequently</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
