import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ExternalLink, Play, Plus, RefreshCw, Save, SlidersHorizontal, Trash2 } from "lucide-react"
import type {
  AnkiCardMapping,
  AnkiImportCardTypeView,
  AnkiImportProcessView,
  ImportPlugin,
} from "@cards/shared"
import { trpc } from "../../infra/trpc"
import { MenuItem, PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { CheckboxCard } from "../../ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { NativeSelect } from "../../ui/native-select"
import { cn } from "../../lib/utils"

type CardMappingRow = { frontField: string; backField: string }

type MappingState = Record<
  string,
  {
    selected: boolean
    subjectField: string
    cardMappings: CardMappingRow[]
    plugins: ImportPlugin[]
  }
>

const EMPTY_MAPPING: CardMappingRow = { frontField: "", backField: "" }

function sampleRowKey(sampleRow: Record<string, string>, index: number) {
  return `${index}:${Object.entries(sampleRow)
    .map(([key, value]) => `${key}:${value}`)
    .join("|")}`
}

function suggestDeckName(filename: string): string {
  return filename
    .replace(/\.apkg$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
}

function applyProcessToForm(
  process: AnkiImportProcessView,
  setDeckName: (value: string) => void,
  setFrontLanguageId: (value: string) => void,
  setBackLanguageId: (value: string) => void,
  setMappings: (value: MappingState) => void
) {
  setDeckName(process.deckName ?? suggestDeckName(process.filename))
  setFrontLanguageId(process.defaultFrontLanguageId ? String(process.defaultFrontLanguageId) : "")
  setBackLanguageId(process.defaultBackLanguageId ? String(process.defaultBackLanguageId) : "")
  setMappings(
    Object.fromEntries(
      process.cardTypes.map((cardType) => [
        cardType.modelKey,
        {
          selected: cardType.selected,
          subjectField: cardType.subjectField ?? "",
          cardMappings:
            cardType.cardMappings.length > 0 ? cardType.cardMappings : [{ ...EMPTY_MAPPING }],
          plugins: cardType.plugins,
        },
      ])
    )
  )
}

function CardTypeSamples({ cardType }: { cardType: AnkiImportCardTypeView }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Raw samples
        </p>
        <p className="text-sm text-muted-foreground">
          {cardType.sampleRows.length === 0 ? "This card type has no rows." : null}
        </p>
      </div>

      {cardType.sampleRows.map((sampleRow, index) => (
        <div key={sampleRowKey(sampleRow, index)} className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sample {index + 1}
          </p>
          <dl className="space-y-2">
            {cardType.fieldNames.map((fieldName) => (
              <div key={fieldName} className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">{fieldName}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm">
                  {sampleRow[fieldName] || <span className="text-muted-foreground">Empty</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function CardTypePreview({ cardType }: { cardType: AnkiImportCardTypeView }) {
  if (cardType.previewCards.length === 0) return null

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview cards
        </p>
        <p className="text-sm text-muted-foreground">
          These are generated from the saved mapping for this card type.
        </p>
      </div>
      {cardType.previewCards.map((previewCard, index) => (
        <div
          key={`${cardType.modelKey}:preview:${index}`}
          className="rounded-md border bg-card p-3"
        >
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Subject</p>
              <p className="whitespace-pre-wrap break-words text-sm">{previewCard.subjectText}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Front</p>
              <p className="whitespace-pre-wrap break-words text-sm">{previewCard.front}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Back</p>
              <p className="whitespace-pre-wrap break-words text-sm">{previewCard.back}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

type CardTypeSetupViewProps = {
  processId: string
  cardType: AnkiImportCardTypeView
  mapping: {
    selected: boolean
    subjectField: string
    cardMappings: CardMappingRow[]
    plugins: ImportPlugin[]
  }
  onChange: (next: {
    selected: boolean
    subjectField: string
    cardMappings: CardMappingRow[]
    plugins: ImportPlugin[]
  }) => void
  onBack: () => void
  disabled?: boolean
}

function CardTypeSetupView({
  processId,
  cardType,
  mapping,
  onChange,
  onBack,
  disabled,
}: CardTypeSetupViewProps) {
  const previewMutation = trpc.ankiImport.previewMapping.useMutation()

  const refreshPreview = () => {
    if (!mapping.subjectField) return
    const validMappings = mapping.cardMappings.filter((cm) => cm.frontField && cm.backField)
    if (!validMappings.length) return
    previewMutation.mutate({
      processId,
      modelKey: cardType.modelKey,
      subjectField: mapping.subjectField,
      cardMappings: validMappings,
      plugins: mapping.plugins,
    })
  }

  const updateCm = (cmIndex: number, patch: Partial<CardMappingRow>) => {
    const next = [...mapping.cardMappings]
    next[cmIndex] = { ...next[cmIndex], ...patch } as CardMappingRow
    onChange({ ...mapping, cardMappings: next })
  }

  const addCm = () =>
    onChange({ ...mapping, cardMappings: [...mapping.cardMappings, { ...EMPTY_MAPPING }] })

  const removeCm = (cmIndex: number) => {
    const next = mapping.cardMappings.filter((_, i) => i !== cmIndex)
    onChange({ ...mapping, cardMappings: next.length > 0 ? next : [{ ...EMPTY_MAPPING }] })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title={cardType.modelName} onBack={onBack} />

      <div className="space-y-1">
        <Label>Subject field</Label>
        <NativeSelect
          value={mapping.subjectField}
          onChange={(next) => onChange({ ...mapping, subjectField: next })}
          placeholder="Choose field"
          disabled={disabled}
          options={cardType.fieldNames.map((f) => ({ value: f, label: f }))}
        />
      </div>

      <div className="space-y-3">
        {mapping.cardMappings.map((cm, cmIndex) => (
          <div key={cmIndex} className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Card template {cmIndex + 1}
              </p>
              {!disabled && mapping.cardMappings.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeCm(cmIndex)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="grid gap-2">
              <div className="space-y-1">
                <Label>Front field</Label>
                <NativeSelect
                  value={cm.frontField}
                  onChange={(next) => updateCm(cmIndex, { frontField: next })}
                  placeholder="Choose field"
                  disabled={disabled}
                  options={cardType.fieldNames.map((f) => ({ value: f, label: f }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Back field</Label>
                <NativeSelect
                  value={cm.backField}
                  onChange={(next) => updateCm(cmIndex, { backField: next })}
                  placeholder="Choose field"
                  disabled={disabled}
                  options={cardType.fieldNames.map((f) => ({ value: f, label: f }))}
                />
              </div>
            </div>
          </div>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={addCm}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-sm text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add card template
          </button>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plugins</p>
        {mapping.plugins.map((plugin, pluginIndex) => (
          <div key={pluginIndex} className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Highlight words</p>
              {!disabled && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...mapping,
                      plugins: mapping.plugins.filter((_, i) => i !== pluginIndex),
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {plugin.type === "highlight_words" && (
              <div className="grid gap-2">
                <div className="space-y-1">
                  <Label>Front words field</Label>
                  <NativeSelect
                    value={plugin.frontWordsField}
                    onChange={(next) => {
                      const next_plugins = [...mapping.plugins]
                      next_plugins[pluginIndex] = { ...plugin, frontWordsField: next }
                      onChange({ ...mapping, plugins: next_plugins })
                    }}
                    placeholder="Choose field"
                    disabled={disabled}
                    options={cardType.fieldNames.map((f) => ({ value: f, label: f }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Back words field</Label>
                  <NativeSelect
                    value={plugin.backWordsField}
                    onChange={(next) => {
                      const next_plugins = [...mapping.plugins]
                      next_plugins[pluginIndex] = { ...plugin, backWordsField: next }
                      onChange({ ...mapping, plugins: next_plugins })
                    }}
                    placeholder="Choose field"
                    disabled={disabled}
                    options={cardType.fieldNames.map((f) => ({ value: f, label: f }))}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...mapping,
                plugins: [
                  ...mapping.plugins,
                  { type: "highlight_words", frontWordsField: "", backWordsField: "" },
                ],
              })
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-sm text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add plugin
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={refreshPreview}
            disabled={disabled || previewMutation.isPending || !mapping.subjectField}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", previewMutation.isPending && "animate-spin")} />
            {previewMutation.isPending ? "Computing…" : "Compute preview"}
          </Button>
        </div>

        {previewMutation.error && (
          <p className="text-sm text-destructive">{previewMutation.error.message}</p>
        )}

        {previewMutation.data && previewMutation.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No preview cards — check that mapped fields are not empty in the sample rows.</p>
        )}

        {previewMutation.data?.map((card, index) => (
          <div key={index} className="rounded-md border bg-card p-3">
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Subject</p>
                <p className="whitespace-pre-wrap break-words text-sm">{card.subjectText}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Front</p>
                <p className="whitespace-pre-wrap break-words text-sm">{card.front}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Back</p>
                <p className="whitespace-pre-wrap break-words text-sm">{card.back}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <CardTypeSamples cardType={cardType} />
      <CardTypePreview cardType={cardType} />
    </div>
  )
}

export function AnkiImportProcessPage() {
  const { processId } = useParams({ from: "/(app)/imports/anki/$processId" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [deckName, setDeckName] = useState("")
  const [frontLanguageId, setFrontLanguageId] = useState("")
  const [backLanguageId, setBackLanguageId] = useState("")
  const [mappings, setMappings] = useState<MappingState>({})
  const [setupModelKey, setSetupModelKey] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [formInitializedFor, setFormInitializedFor] = useState<string | null>(null)

  const process = trpc.ankiImport.get.useQuery(
    { id: processId },
    {
      refetchInterval: ({ state }) => {
        const status = state.data?.status
        return status && ["ANALYZING", "VALIDATING", "IMPORTING"].includes(status) ? 1_000 : false
      },
    }
  )
  const languages = trpc.languages.list.useQuery(undefined, { enabled: !!process.data })

  useEffect(() => {
    if (!process.data || formInitializedFor === process.data.id) return

    applyProcessToForm(
      process.data,
      setDeckName,
      setFrontLanguageId,
      setBackLanguageId,
      setMappings
    )
    setFormInitializedFor(process.data.id)
  }, [formInitializedFor, process.data])

  const saveConfiguration = trpc.ankiImport.saveConfiguration.useMutation({
    onSuccess: (nextProcess) => {
      utils.ankiImport.get.setData({ id: processId }, nextProcess)
      applyProcessToForm(
        nextProcess,
        setDeckName,
        setFrontLanguageId,
        setBackLanguageId,
        setMappings
      )
    },
  })

  const startImport = trpc.ankiImport.startImport.useMutation({
    onSuccess: (nextProcess) => {
      utils.ankiImport.get.setData({ id: processId }, nextProcess)
    },
  })

  const deleteProcess = trpc.ankiImport.delete.useMutation({
    onSuccess: () => {
      utils.ankiImport.list.invalidate()
      navigate({ to: "/imports/anki" })
    },
  })

  const sameLanguage = !!frontLanguageId && !!backLanguageId && frontLanguageId === backLanguageId
  const selectedCardTypes = useMemo(
    () => process.data?.cardTypes.filter((cardType) => mappings[cardType.modelKey]?.selected) ?? [],
    [mappings, process.data?.cardTypes]
  )
  const canSaveConfiguration =
    !!process.data &&
    deckName.trim().length > 0 &&
    !sameLanguage &&
    selectedCardTypes.length > 0 &&
    selectedCardTypes.every((cardType) => {
      const mapping = mappings[cardType.modelKey]
      return (
        !!mapping?.subjectField &&
        (mapping.cardMappings.length ?? 0) > 0 &&
        mapping.cardMappings.every((cm) => cm.frontField && cm.backField)
      )
    })

  const canStartImport =
    !!process.data &&
    process.data.status === "AWAITING_CONFIGURATION" &&
    selectedCardTypes.length > 0 &&
    selectedCardTypes.every((cardType) => cardType.previewCards.length > 0)

  if (!process.data) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <PageHeader title="Anki import" onBack={() => navigate({ to: "/imports/anki" })} />
      </div>
    )
  }

  if (setupModelKey) {
    const cardType = process.data.cardTypes.find((ct) => ct.modelKey === setupModelKey)
    const mapping = mappings[setupModelKey] ?? {
      selected: false,
      subjectField: "",
      cardMappings: [{ ...EMPTY_MAPPING }],
      plugins: [],
    }
    if (cardType) {
      return (
        <CardTypeSetupView
          processId={processId}
          cardType={cardType}
          mapping={mapping}
          onChange={(next) => setMappings((cur) => ({ ...cur, [setupModelKey]: next }))}
          onBack={() => setSetupModelKey(null)}
          disabled={process.data.status === "SUCCEEDED"}
        />
      )
    }
  }

  const submitConfiguration = async () => {
    await saveConfiguration.mutateAsync({
      id: process.data.id,
      deck: {
        name: deckName.trim(),
        defaultFrontLanguageId: frontLanguageId ? Number(frontLanguageId) : null,
        defaultBackLanguageId: backLanguageId ? Number(backLanguageId) : null,
        inverseReviewEnabled: false,
      },
      cardTypes: process.data.cardTypes.map((cardType) => {
        const mapping = mappings[cardType.modelKey] ?? {
          selected: false,
          subjectField: "",
          cardMappings: [],
          plugins: [] as ImportPlugin[],
        }
        return {
          modelKey: cardType.modelKey,
          selected: mapping.selected,
          subjectField: mapping.selected ? mapping.subjectField || undefined : undefined,
          cardMappings: mapping.selected
            ? (mapping.cardMappings.filter(
                (cm) => cm.frontField && cm.backField
              ) as AnkiCardMapping[])
            : [],
          plugins: mapping.selected ? mapping.plugins : [],
        }
      }),
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Anki import"
        onBack={() => navigate({ to: "/imports/anki" })}
        menuItems={
          <MenuItem
            onSelect={() => setDeleteOpen(true)}
            icon={<Trash2 className="h-[18px] w-[18px]" />}
            destructive
          >
            Delete import
          </MenuItem>
        }
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete import?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the import record and its uploaded file. Any deck already
            created from this import will not be affected.
          </p>
          {deleteProcess.error && (
            <p className="text-sm text-destructive">{deleteProcess.error.message}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteProcess.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteProcess.mutate({ id: processId })}
              disabled={deleteProcess.isPending}
            >
              {deleteProcess.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {process.data.status === "ANALYZING" && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="font-medium">
              Analyzing <span className="break-all">{process.data.filename}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              The worker is extracting card types and sample rows from the uploaded Anki package.
            </p>
          </CardContent>
        </Card>
      )}

      {(process.data.status === "AWAITING_CONFIGURATION" ||
        process.data.status === "SUCCEEDED") && (
        <>
          {process.data.status === "SUCCEEDED" && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="font-medium">Import completed</p>
                  <p className="text-sm text-muted-foreground">
                    Imported {process.data.importedCardCount} cards from{" "}
                    <span className="break-all">{process.data.filename}</span>.
                  </p>
                </div>
                {process.data.createdDeckId && (
                  <Link
                    to="/decks/$deckId"
                    params={{ deckId: process.data.createdDeckId }}
                    className={cn(buttonVariants({ className: "w-full gap-2" }))}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open imported deck
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          {(() => {
            const disabled = process.data.status === "SUCCEEDED"
            return (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">New deck</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="deck-name">Deck name</Label>
                      <Input
                        id="deck-name"
                        value={deckName}
                        onChange={(event) => setDeckName(event.target.value)}
                        placeholder="e.g. Imported German A1"
                        disabled={disabled}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label>Translating from language (optional)</Label>
                      <NativeSelect
                        value={frontLanguageId}
                        onChange={(next) => {
                          setFrontLanguageId(next)
                          if (next === backLanguageId) setBackLanguageId("")
                        }}
                        placeholder="Choose language"
                        disabled={disabled}
                        options={
                          languages.data?.map((language) => ({
                            value: String(language.id),
                            label: `${language.emoji} ${language.name}`,
                            disabled: String(language.id) === backLanguageId,
                          })) ?? []
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label>Study language (optional)</Label>
                      <NativeSelect
                        value={backLanguageId}
                        onChange={(next) => {
                          setBackLanguageId(next)
                          if (next === frontLanguageId) setFrontLanguageId("")
                        }}
                        placeholder="Choose language"
                        disabled={disabled}
                        options={
                          languages.data?.map((language) => ({
                            value: String(language.id),
                            label: `${language.emoji} ${language.name}`,
                            disabled: String(language.id) === frontLanguageId,
                          })) ?? []
                        }
                      />
                      {sameLanguage && (
                        <p className="text-sm text-destructive">Languages must be different.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {process.data.cardTypes.map((cardType) => {
                    const mapping = mappings[cardType.modelKey] ?? {
                      selected: false,
                      subjectField: "",
                      cardMappings: [{ ...EMPTY_MAPPING }],
                      plugins: [] as ImportPlugin[],
                    }
                    const configuredCount = mapping.cardMappings.filter(
                      (cm) => cm.frontField && cm.backField
                    ).length

                    return (
                      <Card key={cardType.id}>
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between gap-3 text-base">
                            <span>{cardType.modelName}</span>
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {cardType.modelKind.toLowerCase()} · {cardType.rowCount} rows
                            </span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <CheckboxCard
                            checked={mapping.selected}
                            onChange={(next) =>
                              setMappings(
                                (current) =>
                                  ({
                                    ...current,
                                    [cardType.modelKey]: { ...mapping, selected: next },
                                  }) as MappingState
                              )
                            }
                            label="Import this card type"
                            disabled={disabled}
                          />

                          <div className="rounded-md border bg-muted/20 p-3 text-sm">
                            <p className="mb-2 font-medium">Available fields</p>
                            <p className="break-words text-muted-foreground">
                              {cardType.fieldNames.join(", ")}
                            </p>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-2"
                            onClick={() => setSetupModelKey(cardType.modelKey)}
                          >
                            <SlidersHorizontal className="h-4 w-4" />
                            {configuredCount > 0
                              ? `Setup · ${configuredCount} template${configuredCount !== 1 ? "s" : ""}`
                              : "Setup"}
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {!disabled && (
                  <>
                    {(saveConfiguration.error || startImport.error || process.error) && (
                      <p className="text-sm text-destructive">
                        {saveConfiguration.error?.message ??
                          startImport.error?.message ??
                          process.error?.message}
                      </p>
                    )}

                    <div className="mt-auto space-y-2">
                      <Button
                        variant="secondary"
                        className="w-full gap-2"
                        onClick={submitConfiguration}
                        disabled={!canSaveConfiguration || saveConfiguration.isPending}
                      >
                        <Save className="h-4 w-4" />
                        {saveConfiguration.isPending ? "Saving…" : "Save mappings"}
                      </Button>
                      <Button
                        className="w-full gap-2"
                        onClick={async () => {
                          if (canSaveConfiguration) await submitConfiguration()
                          startImport.mutate({ id: process.data.id })
                        }}
                        disabled={
                          !canStartImport || startImport.isPending || saveConfiguration.isPending
                        }
                      >
                        <Play className="h-4 w-4" />
                        {startImport.isPending ? "Starting…" : "Start import"}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )
          })()}
        </>
      )}

      {(process.data.status === "VALIDATING" || process.data.status === "IMPORTING") && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="font-medium">
              {process.data.status === "VALIDATING" ? "Validating import" : "Importing cards"}
            </p>
            <p className="text-sm text-muted-foreground">
              {process.data.status === "VALIDATING"
                ? "The worker is validating the mapped rows before any deck or card is created."
                : "The worker is creating the new deck and inserting cards."}
            </p>
          </CardContent>
        </Card>
      )}

      {process.data.status === "FAILED" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="font-medium text-destructive">Import failed</p>
              <p className="text-sm text-muted-foreground">
                {process.data.errorSummary ?? "The import worker reported a failure."}
              </p>
            </div>
            {process.data.errorDetails.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {process.data.errorDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
