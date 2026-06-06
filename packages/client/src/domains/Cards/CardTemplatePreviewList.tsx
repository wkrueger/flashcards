import { ChangeEvent, useEffect, useRef, useState } from "react"
import { Check, RefreshCw, Trash2, X } from "lucide-react"
import { MarkdownView } from "../../components/MarkdownView"
import { Button } from "../../ui/Button"
import { Card, CardContent } from "../../ui/Card"
import { cn } from "../../Lib/Utils"
import { generatedTagPrefix } from "./CardFrontPrefix"

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

export interface PreviewCard {
  front: string
  back: string
  tags: string[]
}

export function CardTemplatePreviewList({
  cards,
  regeneratingIndex,
  onRegenerate,
  onRemove,
  onUpdate,
}: {
  cards: PreviewCard[]
  regeneratingIndex: number | null
  onRegenerate: (index: number) => void
  onRemove: (index: number) => void
  onUpdate: (index: number, card: PreviewCard) => void
}) {
  return (
    <ul className="space-y-3">
      {cards.map((card, index) => (
        <li key={`${card.front}-${index}`}>
          <CardTemplatePreviewCard
            card={card}
            index={index}
            isRegenerating={regeneratingIndex === index}
            actionsDisabled={regeneratingIndex !== null}
            removeDisabled={cards.length <= 1}
            onRegenerate={onRegenerate}
            onRemove={onRemove}
            onUpdate={onUpdate}
          />
        </li>
      ))}
    </ul>
  )
}

function CardTemplatePreviewCard({
  card,
  index,
  isRegenerating,
  actionsDisabled,
  removeDisabled,
  onRegenerate,
  onRemove,
  onUpdate,
}: {
  card: PreviewCard
  index: number
  isRegenerating: boolean
  actionsDisabled: boolean
  removeDisabled: boolean
  onRegenerate: (index: number) => void
  onRemove: (index: number) => void
  onUpdate: (index: number, card: PreviewCard) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftFront, setDraftFront] = useState(card.front)
  const [draftBack, setDraftBack] = useState(card.back)

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

  const confirmEditing = () => {
    const front = draftFront.trim()
    const back = draftBack.trim()
    if (!front || !back) return
    onUpdate(index, { ...card, front, back })
    setEditing(false)
  }

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
                  <MarkdownView source={card.front} prefix={generatedTagPrefix(card.tags)} />
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
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Regenerate card"
                  disabled={actionsDisabled}
                  onClick={() => onRegenerate(index)}
                >
                  <RefreshCw className={cn("h-4 w-4", isRegenerating && "animate-spin")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove card"
                  disabled={removeDisabled}
                  onClick={() => onRemove(index)}
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
