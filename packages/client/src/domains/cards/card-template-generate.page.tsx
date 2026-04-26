import { FormEvent, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, RefreshCw, RotateCw, Sparkles, Trash2 } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { cn } from "../../lib/utils"
import { MarkdownView } from "../../components/MarkdownView"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { PageHeader } from "../../components/AppShell"

const TEMPLATE = "createPhrasesForWords"

interface PreviewCard {
  front: string
  back: string
}

function languageLabel(language: { emoji: string; name: string }) {
  return `${language.emoji} ${language.name}`
}

export function CardTemplateGeneratePage() {
  const { deckId } = useParams({ from: "/decks/$deckId/cards/generate" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const languages = trpc.languages.list.useQuery()
  const deck = trpc.decks.get.useQuery({ id: deckId })

  const englishFallback = useMemo(
    () => languages.data?.find((language) => language.name.toLowerCase() === "english"),
    [languages.data]
  )
  const deutschFallback = useMemo(
    () => languages.data?.find((language) => language.name.toLowerCase() === "deutsch"),
    [languages.data]
  )

  const [frontLanguageId, setFrontLanguageId] = useState("")
  const [backLanguageId, setBackLanguageId] = useState("")
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const [wordOrExpression, setWordOrExpression] = useState("")
  const [count, setCount] = useState("3")
  const [previewCards, setPreviewCards] = useState<PreviewCard[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (defaultsApplied) return
    if (!deck.data || !languages.data) return
    const front =
      deck.data.defaultFrontLanguageId != null
        ? String(deck.data.defaultFrontLanguageId)
        : englishFallback
          ? String(englishFallback.id)
          : ""
    const back =
      deck.data.defaultBackLanguageId != null
        ? String(deck.data.defaultBackLanguageId)
        : deutschFallback
          ? String(deutschFallback.id)
          : ""
    setFrontLanguageId(front)
    setBackLanguageId(back)
    setDefaultsApplied(true)
  }, [defaultsApplied, deck.data, languages.data, englishFallback, deutschFallback])

  const generate = trpc.cardTemplate.generatePreviews.useMutation({
    onSuccess: (data) => {
      setPreviewCards(data.cards)
      setPreviewError(null)
      setSaveError(null)
    },
    onError: (error) => {
      setPreviewError(error.message)
    },
  })

  const create = trpc.cards.create.useMutation()
  const selectedFrontId = Number(frontLanguageId)
  const selectedBackId = Number(backLanguageId)
  const subjectText = wordOrExpression.trim()
  const selectionsMatch = !!frontLanguageId && frontLanguageId === backLanguageId
  const canSubmit =
    !!frontLanguageId && !!backLanguageId && !selectionsMatch && !!subjectText && !!count

  const submitGenerate = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit) return
    generate.mutate({
      template: TEMPLATE,
      frontLanguageId: selectedFrontId,
      backLanguageId: selectedBackId,
      wordOrExpression: subjectText,
      count: Number(count),
    })
  }

  const regenerateCard = async (index: number) => {
    if (!frontLanguageId || !backLanguageId || !wordOrExpression.trim()) return
    setRegeneratingIndex(index)
    try {
      const result = await generate.mutateAsync({
        template: TEMPLATE,
        frontLanguageId: Number(frontLanguageId),
        backLanguageId: Number(backLanguageId),
        wordOrExpression: wordOrExpression.trim(),
        count: 1,
      })
      if (result.cards[0]) {
        setPreviewCards((prev) =>
          prev ? prev.map((c, i) => (i === index ? result.cards[0]! : c)) : prev
        )
      }
    } catch {
      // error already shown via previewError state from onError
    } finally {
      setRegeneratingIndex(null)
    }
  }

  const removeCard = (index: number) => {
    setPreviewCards((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
  }

  const confirm = async () => {
    if (!previewCards) return
    setSaveError(null)
    try {
      for (const card of previewCards) {
        await create.mutateAsync({
          deckId,
          subjectText,
          front: card.front,
          back: card.back,
        })
      }
      utils.cards.listByDeck.invalidate({ id: deckId })
      utils.decks.list.invalidate()
      utils.review.next.invalidate()
      navigate({ to: "/decks/$deckId", params: { deckId } })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not create cards.")
    }
  }

  if (previewCards) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <PageHeader
          title="Preview cards"
          onBack={() => navigate({ to: "/decks/$deckId/cards/new", params: { deckId } })}
        />

        <ul className="space-y-3">
          {previewCards.map((card, index) => (
            <li key={`${card.front}-${index}`}>
              <Card className={regeneratingIndex === index ? "opacity-50" : ""}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                          Front
                        </p>
                        <MarkdownView source={card.front} />
                      </div>
                      <div className="border-t pt-3">
                        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                          Back
                        </p>
                        <MarkdownView source={card.back} />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 pt-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Regenerate card"
                        disabled={regeneratingIndex !== null}
                        onClick={() => regenerateCard(index)}
                      >
                        <RefreshCw
                          className={cn("h-4 w-4", regeneratingIndex === index && "animate-spin")}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove card"
                        disabled={previewCards.length <= 1}
                        onClick={() => removeCard(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        {(saveError || create.error) && (
          <p className="text-sm text-destructive">{saveError ?? create.error?.message}</p>
        )}

        <div className="mt-auto space-y-2">
          <Button className="w-full" onClick={confirm} disabled={create.isPending}>
            {create.isPending ? "…" : "Confirm generation"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full gap-2"
            onClick={() => submitGenerate()}
            disabled={generate.isPending}
          >
            <RotateCw className="h-4 w-4" />
            {generate.isPending ? "Regenerating…" : "Regenerate previews"}
          </Button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost", className: "w-full" }))}
            onClick={() => setPreviewCards(null)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Generate card"
        onBack={() => navigate({ to: "/decks/$deckId/cards/new", params: { deckId } })}
      />

      <form className="flex flex-1 flex-col gap-3" onSubmit={submitGenerate}>
        <div className="space-y-1">
          <Label>Template</Label>
          <Select value={TEMPLATE} disabled>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TEMPLATE}>Create phrases for words</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Front Language</Label>
          <Select
            value={frontLanguageId}
            onValueChange={(next) => {
              setFrontLanguageId(next)
              if (next === backLanguageId) setBackLanguageId("")
            }}
            disabled={languages.isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose language" />
            </SelectTrigger>
            <SelectContent>
              {languages.data?.map((language) => (
                <SelectItem
                  key={language.id}
                  value={String(language.id)}
                  disabled={String(language.id) === backLanguageId}
                >
                  {languageLabel(language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Back Language</Label>
          <Select
            value={backLanguageId}
            onValueChange={(next) => {
              setBackLanguageId(next)
              if (next === frontLanguageId) setFrontLanguageId("")
            }}
            disabled={languages.isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose language" />
            </SelectTrigger>
            <SelectContent>
              {languages.data?.map((language) => (
                <SelectItem
                  key={language.id}
                  value={String(language.id)}
                  disabled={String(language.id) === frontLanguageId}
                >
                  {languageLabel(language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectionsMatch && (
            <p className="text-sm text-destructive">Languages must be different.</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="wordOrExpression">
            Word or expression
            {backLanguageId && (
              <span className="ml-1">
                in{" "}
                {languageLabel(
                  languages.data?.find((l) => String(l.id) === backLanguageId) ?? {
                    emoji: "",
                    name: "…",
                  }
                )}
              </span>
            )}
          </Label>
          <Input
            id="wordOrExpression"
            value={wordOrExpression}
            onChange={(event) => setWordOrExpression(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <Label>Number of cards to generate</Label>
          <Select value={count} onValueChange={setCount}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {previewError && <p className="text-sm text-destructive">{previewError}</p>}

        <Button
          type="submit"
          className="mt-auto w-full gap-2"
          disabled={!canSubmit || generate.isPending}
        >
          <Sparkles className="h-4 w-4" />
          {generate.isPending ? "Generating…" : "Generate previews"}
        </Button>
      </form>
    </div>
  )
}
