import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Link, useNavigate } from "@tanstack/react-router"
import { FileDown, FileText, FileUp, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { MenuItem, PageHeader } from "../../components/AppShell"
import { LightbulbIllustration } from "../../components/LightbulbIllustration"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/Button"
import { Card, CardContent } from "../../ui/Card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../../ui/Dialog"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"
import { DeckSearch } from "./DeckSearch"
import { LanguageSelect } from "./LanguageSelect"

type DeckItem = { id: string; name: string; dueCount: number }

const cardClass =
  "flex min-h-[88px] items-center justify-between rounded-md border bg-card px-4 py-4 text-sm"

function DeckCardBody({ deck }: { deck: DeckItem }) {
  return (
    <>
      <span className="min-w-0 flex-1 font-medium">{deck.name}</span>
      <span className="ml-3 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {deck.dueCount} to do
      </span>
    </>
  )
}

function SortableDeckItem({ deck }: { deck: DeckItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deck.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style}>
      <Link
        to="/decks/$deckId"
        params={{ deckId: deck.id }}
        onContextMenu={(e) => e.preventDefault()}
        className={`${cardClass} cursor-grab select-none transition duration-150 [-webkit-touch-callout:none] hover:bg-accent active:cursor-grabbing active:bg-[hsl(var(--accent-strong))] active:opacity-80`}
        {...attributes}
        {...listeners}
      >
        <DeckCardBody deck={deck} />
      </Link>
    </li>
  )
}

export function DeckListPage() {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const [rawQuery, setRawQuery] = useState("")
  const [query, setQuery] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 250)
    return () => clearTimeout(id)
  }, [rawQuery])

  const decksQuery = trpc.decks.list.useInfiniteQuery(
    { q: query || undefined, limit: 30 },
    { getNextPageParam: (last) => last.nextCursor }
  )
  const move = trpc.decks.move.useMutation({
    onSettled: () => utils.decks.list.invalidate(),
  })
  const create = trpc.decks.create.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      setName("")
      setFrontLanguageId("")
      setBackLanguageId("")
      setOpen(false)
    },
  })
  const [items, setItems] = useState<DeckItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [frontLanguageId, setFrontLanguageId] = useState("")
  const [backLanguageId, setBackLanguageId] = useState("")
  const [open, setOpen] = useState(false)
  const [showLoader, setShowLoader] = useState(false)

  const flatItems = useMemo<DeckItem[]>(
    () => decksQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [decksQuery.data]
  )
  useEffect(() => {
    setItems(flatItems)
  }, [flatItems])

  useEffect(() => {
    if (!decksQuery.isLoading) return
    const id = setTimeout(() => setShowLoader(true), 1500)
    return () => clearTimeout(id)
  }, [decksQuery.isLoading])

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && decksQuery.hasNextPage && !decksQuery.isFetchingNextPage) {
        decksQuery.fetchNextPage()
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [decksQuery.hasNextPage, decksQuery.isFetchingNextPage, decksQuery.fetchNextPage])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: press-and-hold to start dragging; moving within the hold scrolls instead.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )
  const sameLanguage = !!frontLanguageId && !!backLanguageId && frontLanguageId === backLanguageId
  const activeDeck = items.find((d) => d.id === activeId) ?? null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    // The browser fires a click after the drag's pointerup. Swallow that one
    // click at the document capture phase so it never reaches the TanStack Link.
    const suppressClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener("click", suppressClick, { capture: true, once: true })
    setTimeout(() => document.removeEventListener("click", suppressClick, { capture: true }), 250)

    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const oldIndex = prev.findIndex((d) => d.id === active.id)
      const newIndex = prev.findIndex((d) => d.id === over.id)
      const next = arrayMove(prev, oldIndex, newIndex)
      const movedIndex = next.findIndex((d) => d.id === active.id)
      const afterId = movedIndex > 0 ? next[movedIndex - 1]!.id : null
      move.mutate({ id: String(active.id), afterId })
      return next
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Your decks"
        actions={
          <>
            <DeckSearch value={rawQuery} onChange={setRawQuery} />
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
            <MenuItem
              onSelect={() => navigate({ to: "/imports/spreadsheet" })}
              icon={<FileUp className="h-[18px] w-[18px]" />}
              aria-label="Import XLS"
            >
              Import XLS
            </MenuItem>
            <MenuItem
              onSelect={() => {
                window.location.href = "/api/decks/spreadsheet/template"
              }}
              icon={<FileText className="h-[18px] w-[18px]" />}
              aria-label="Download XLS template"
            >
              Download XLS template
            </MenuItem>
          </>
        }
      />

      {decksQuery.isLoading ? (
        showLoader && (
          <div className="flex items-center justify-center gap-1.5 py-8">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
          </div>
        )
      ) : items.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="animate-reveal space-y-2">
              {items.map((d) => (
                <SortableDeckItem key={d.id} deck={d} />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {activeDeck ? (
              <div className={`${cardClass} cursor-grabbing shadow-lg`}>
                <DeckCardBody deck={activeDeck} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <p className="animate-reveal text-sm text-muted-foreground">
          {query ? `No decks match “${query}”.` : "No decks yet — create your first one."}
        </p>
      )}

      <div ref={sentinelRef} aria-hidden className="h-1" />

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
