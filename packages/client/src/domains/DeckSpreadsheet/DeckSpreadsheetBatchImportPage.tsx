import { useEffect, useMemo, useState } from "react"
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router"
import { FileSpreadsheet } from "lucide-react"
import { PageHeader } from "../../components/AppShell"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/Button"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"

const routeApi = getRouteApi("/(app)/imports/spreadsheet-batch")

type Mode = "update" | "create"
type Edit = { mode: Mode; name: string }

export function DeckSpreadsheetBatchImportPage() {
  const { batchId, deckId } = routeApi.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmBatch = trpc.deckSpreadsheet.confirmBatch.useMutation()

  const batch = trpc.deckSpreadsheet.getBatch.useQuery(
    { batchId },
    {
      refetchInterval: ({ state }) => {
        if (!confirmed) return false
        const status = state.data?.status
        return status && ["UPLOADED", "IMPORTING"].includes(status) ? 2_000 : false
      },
    }
  )

  // Seed per-file edit state once inspection results arrive: default to
  // updating when the spreadsheet matched an owned deck, otherwise create.
  useEffect(() => {
    if (confirmed || !batch.data) return
    setEdits((current) => {
      if (Object.keys(current).length === batch.data.items.length) return current
      const next: Record<string, Edit> = {}
      for (const item of batch.data.items) {
        next[item.importId] = current[item.importId] ?? {
          mode: item.existingDeck ? "update" : "create",
          name: item.suggestedName,
        }
      }
      return next
    })
  }, [batch.data, confirmed])

  const items = useMemo(() => batch.data?.items ?? [], [batch.data])
  const hasUnreadableFile = items.some((item) => item.status === "FAILED")
  const canRun = useMemo(() => {
    if (items.length === 0 || hasUnreadableFile) return false
    return items.every((item) => {
      const edit = edits[item.importId]
      if (!edit) return false
      return edit.mode === "update" || edit.name.trim().length > 0
    })
  }, [items, edits, hasUnreadableFile])

  const succeeded = confirmed && batch.data?.status === "SUCCEEDED"
  const failed = confirmed && batch.data?.status === "FAILED"

  const setEdit = (importId: string, patch: Partial<Edit>) =>
    setEdits((current) => ({
      ...current,
      [importId]: { ...current[importId]!, ...patch },
    }))

  const run = () => {
    setError(null)
    confirmBatch.mutate(
      {
        items: items.map((item) => {
          const edit = edits[item.importId]!
          return {
            importId: item.importId,
            mode: edit.mode,
            name: edit.mode === "create" ? edit.name.trim() : undefined,
          }
        }),
      },
      {
        onSuccess: () => {
          setConfirmed(true)
          utils.decks.list.invalidate()
        },
        onError: (mutationError) => setError(mutationError.message),
      }
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Import decks from zip" onBack={() => router.history.back()} />

      {batch.isLoading && <p className="text-sm text-muted-foreground">Reading archive…</p>}

      {batch.error && <p className="text-sm text-destructive">{batch.error.message}</p>}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => {
            const edit = edits[item.importId]
            return (
              <div key={item.importId} className="space-y-2 rounded-md border bg-card p-3 text-sm">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate font-medium" title={item.filename ?? ""}>
                    {item.filename}
                  </p>
                  {confirmed && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.status.toLowerCase()}
                    </span>
                  )}
                </div>

                {item.status === "FAILED" && item.errorSummary && (
                  <p className="text-destructive">{item.errorSummary}</p>
                )}

                {!confirmed && edit && item.status !== "FAILED" && (
                  <div className="space-y-2">
                    {item.existingDeck && (
                      <div className="space-y-1">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`mode-${item.importId}`}
                            checked={edit.mode === "update"}
                            onChange={() => setEdit(item.importId, { mode: "update" })}
                          />
                          <span>
                            Update <strong>{item.existingDeck.name}</strong>
                          </span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`mode-${item.importId}`}
                            checked={edit.mode === "create"}
                            onChange={() => setEdit(item.importId, { mode: "create" })}
                          />
                          <span>Create a new deck</span>
                        </label>
                      </div>
                    )}
                    {edit.mode === "create" && (
                      <div className="space-y-1">
                        <Label htmlFor={`name-${item.importId}`}>New deck name</Label>
                        <Input
                          id={`name-${item.importId}`}
                          value={edit.name}
                          onChange={(event) => setEdit(item.importId, { name: event.target.value })}
                          placeholder="e.g. German A1"
                        />
                      </div>
                    )}
                  </div>
                )}

                {confirmed && item.status === "SUCCEEDED" && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-base font-semibold">{item.createdCardCount}</p>
                      <p className="text-xs text-muted-foreground">created</p>
                    </div>
                    <div>
                      <p className="text-base font-semibold">{item.updatedCardCount}</p>
                      <p className="text-xs text-muted-foreground">updated</p>
                    </div>
                    <div>
                      <p className="text-base font-semibold">{item.deletedCardCount}</p>
                      <p className="text-xs text-muted-foreground">deleted</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {hasUnreadableFile && !confirmed && (
        <p className="text-sm text-destructive">
          One or more spreadsheets could not be read. Fix the zip and upload again.
        </p>
      )}

      {failed && (
        <p className="text-sm text-destructive">
          The import failed and nothing was changed. {batch.data?.errorSummary}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="mt-auto space-y-2">
        {!confirmed && (
          <Button className="w-full" onClick={run} disabled={!canRun || confirmBatch.isPending}>
            {confirmBatch.isPending ? "Starting…" : `Import ${items.length} deck(s)`}
          </Button>
        )}

        {(succeeded || failed) && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              utils.decks.list.invalidate()
              if (deckId) {
                utils.decks.get.invalidate({ id: deckId })
                navigate({ to: "/decks/$deckId", params: { deckId } })
              } else {
                navigate({ to: "/" })
              }
            }}
          >
            Back to decks
          </Button>
        )}
      </div>
    </div>
  )
}
