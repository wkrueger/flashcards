import { useState } from "react"
import { RefreshCw, Trash2 } from "lucide-react"
import { MarkdownView } from "../../components/MarkdownView"
import { Button } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { Textarea } from "../../ui/textarea"
import { cn } from "../../lib/utils"
import { displayFrontWithGeneratedTagPrefix } from "./card-front-prefix"

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
                <Textarea
                  value={draftFront}
                  onChange={(event) => setDraftFront(event.target.value)}
                  rows={4}
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
                <Textarea
                  value={draftBack}
                  onChange={(event) => setDraftBack(event.target.value)}
                  rows={4}
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
                  size="sm"
                  disabled={!draftFront.trim() || !draftBack.trim()}
                  onClick={confirmEditing}
                >
                  Confirm
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancelEditing}>
                  Cancel
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
