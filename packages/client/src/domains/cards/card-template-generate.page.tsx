import { FormEvent, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { ArrowLeft, RotateCw, Sparkles } from "lucide-react"
import { trpc } from "../../infra/trpc"
import { cn } from "../../lib/utils"
import { Button, buttonVariants } from "../../ui/button"
import { Label } from "../../ui/label"
import { NativeSelect } from "../../ui/native-select"
import { PageHeader } from "../../components/AppShell"
import { SubjectAutocomplete } from "./subject-autocomplete"
import { CardTemplatePreviewList, type PreviewCard } from "./card-template-preview"

const TEMPLATE = "createPhrasesForWords"

function languageLabel(language: { emoji: string; name: string }) {
  return `${language.emoji} ${language.name}`
}

export function CardTemplateGeneratePage() {
  const { deckId } = useParams({ from: "/(app)/decks/$deckId/cards/generate" })
  const navigate = useNavigate()
  const router = useRouter()
  const goBack = () => {
    if (router.history.length > 1) router.history.back()
    else navigate({ to: "/decks/$deckId", params: { deckId } })
  }
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
  const [count, setCount] = useState("4")
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

  const submitGenerate = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit) return
    try {
      const result = await generate.mutateAsync({
        template: TEMPLATE,
        frontLanguageId: selectedFrontId,
        backLanguageId: selectedBackId,
        wordOrExpression: subjectText,
        count: Number(count),
      })
      setPreviewCards(result.cards)
      setPreviewError(null)
      setSaveError(null)
    } catch {
      // error already shown via previewError state from onError
    }
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

  const updateCard = (index: number, card: PreviewCard) => {
    setPreviewCards((prev) => (prev ? prev.map((c, i) => (i === index ? card : c)) : prev))
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
          genTemplate: TEMPLATE,
          tags: card.tags,
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
        <PageHeader title="Preview cards" onBack={() => setPreviewCards(null)} />

        <CardTemplatePreviewList
          cards={previewCards}
          regeneratingIndex={regeneratingIndex}
          onRegenerate={regenerateCard}
          onRemove={removeCard}
          onUpdate={updateCard}
        />

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

  if (!deck.data || !languages.data) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <PageHeader title="Generate card" onBack={goBack} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Generate card" onBack={goBack} />

      <form className="flex flex-1 flex-col gap-3" onSubmit={submitGenerate}>
        <div className="space-y-1">
          <Label>Template</Label>
          <NativeSelect
            value={TEMPLATE}
            onChange={() => {}}
            options={[{ value: TEMPLATE, label: "Create phrases for words" }]}
            disabled
          />
        </div>

        <div className="space-y-1">
          <Label>Front Language</Label>
          <NativeSelect
            value={frontLanguageId}
            onChange={(next) => {
              setFrontLanguageId(next)
              if (next === backLanguageId) setBackLanguageId("")
            }}
            disabled={languages.isLoading}
            placeholder="Choose language"
            options={
              languages.data?.map((language) => ({
                value: String(language.id),
                label: languageLabel(language),
                disabled: String(language.id) === backLanguageId,
              })) ?? []
            }
          />
        </div>

        <div className="space-y-1">
          <Label>Back Language</Label>
          <NativeSelect
            value={backLanguageId}
            onChange={(next) => {
              setBackLanguageId(next)
              if (next === frontLanguageId) setFrontLanguageId("")
            }}
            disabled={languages.isLoading}
            placeholder="Choose language"
            options={
              languages.data?.map((language) => ({
                value: String(language.id),
                label: languageLabel(language),
                disabled: String(language.id) === frontLanguageId,
              })) ?? []
            }
          />
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
          <SubjectAutocomplete value={wordOrExpression} onChange={setWordOrExpression} />
        </div>

        <div className="space-y-1">
          <Label>Number of cards to generate</Label>
          <NativeSelect
            value={count}
            onChange={setCount}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          />
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
