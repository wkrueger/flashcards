import { useRef, useState } from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { FileSpreadsheet, Upload } from "lucide-react"
import type { DeckSpreadsheetInspectResult } from "@cards/shared"
import { PageHeader } from "../../components/AppShell"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/Button"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"

type Mode = "update" | "create"

export function DeckSpreadsheetNewImportPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [inspect, setInspect] = useState<DeckSpreadsheetInspectResult | null>(null)
  const [mode, setMode] = useState<Mode>("create")
  const [name, setName] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmImport = trpc.deckSpreadsheet.confirmImport.useMutation()

  const importStatus = trpc.deckSpreadsheet.getImport.useQuery(
    { id: inspect?.importId ?? "" },
    {
      enabled: confirmed && !!inspect,
      refetchInterval: ({ state }) => {
        const status = state.data?.status
        return status && ["UPLOADED", "IMPORTING"].includes(status) ? 2_000 : false
      },
    }
  )

  const succeeded = importStatus.data?.status === "SUCCEEDED"
  const resolvedDeckId = importStatus.data?.deckId ?? null

  const upload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.set("file", file)
      const response = await fetch("/api/decks/spreadsheet/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const payload = (await response.json().catch(() => null)) as
        | (DeckSpreadsheetInspectResult & { message?: string })
        | null
      if (!response.ok || !payload?.importId) {
        throw new Error(payload?.message ?? "Could not read the spreadsheet.")
      }
      setInspect(payload)
      setMode(payload.existingDeck ? "update" : "create")
      setName(payload.suggestedName)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.")
    } finally {
      setUploading(false)
    }
  }

  const confirm = () => {
    if (!inspect) return
    setError(null)
    confirmImport.mutate(
      {
        importId: inspect.importId,
        mode,
        name: mode === "create" ? name.trim() : undefined,
      },
      {
        onSuccess: () => setConfirmed(true),
        onError: (mutationError) => setError(mutationError.message),
      }
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Import deck" onBack={() => router.history.back()} />

      {!inspect && (
        <div className="space-y-2">
          <Label htmlFor="spreadsheet-file">Spreadsheet file</Label>
          <input
            ref={inputRef}
            id="spreadsheet-file"
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-6 w-6" />
            <span className="font-medium text-foreground">
              {file ? "Choose a different file" : "Tap to choose a file"}
            </span>
            <span className="text-xs">
              Single <code>.xlsx</code> file, up to 20MB.
            </span>
          </button>
          {file && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                {file.name}
              </p>
            </div>
          )}
        </div>
      )}

      {inspect && !confirmed && (
        <div className="space-y-4">
          {inspect.existingDeck && (
            <div className="space-y-2">
              <Label>This spreadsheet matches an existing deck</Label>
              <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "update"}
                    onChange={() => setMode("update")}
                  />
                  <span>
                    Update existing deck <strong>{inspect.existingDeck.name}</strong>
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "create"}
                    onChange={() => setMode("create")}
                  />
                  <span>Create a new deck</span>
                </label>
              </div>
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-1">
              <Label htmlFor="new-deck-name">New deck name</Label>
              <Input
                id="new-deck-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. German A1"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {confirmed && importStatus.data && (
        <div className="space-y-2 rounded-md border bg-card p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Status</span>
            <span>{importStatus.data.status.toLowerCase()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold">{importStatus.data.createdCardCount}</p>
              <p className="text-xs text-muted-foreground">created</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{importStatus.data.updatedCardCount}</p>
              <p className="text-xs text-muted-foreground">updated</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{importStatus.data.deletedCardCount}</p>
              <p className="text-xs text-muted-foreground">deleted</p>
            </div>
          </div>
          {importStatus.data.errorSummary && (
            <p className="text-sm text-destructive">{importStatus.data.errorSummary}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="mt-auto space-y-2">
        {!inspect && (
          <Button className="w-full" onClick={upload} disabled={!file || uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Reading..." : "Upload spreadsheet"}
          </Button>
        )}

        {inspect && !confirmed && (
          <Button
            className="w-full"
            onClick={confirm}
            disabled={confirmImport.isPending || (mode === "create" && !name.trim())}
          >
            {confirmImport.isPending
              ? "Starting..."
              : mode === "update"
                ? "Update deck"
                : "Create deck"}
          </Button>
        )}

        {succeeded && resolvedDeckId && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              utils.decks.list.invalidate()
              utils.decks.get.invalidate({ id: resolvedDeckId })
              navigate({ to: "/decks/$deckId", params: { deckId: resolvedDeckId } })
            }}
          >
            Go to deck
          </Button>
        )}
      </div>
    </div>
  )
}
