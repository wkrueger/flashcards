import { useRef, useState } from "react"
import { useNavigate, useParams, useRouter } from "@tanstack/react-router"
import { FileSpreadsheet, Upload } from "lucide-react"
import { PageHeader } from "../../components/AppShell"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/Button"
import { Label } from "../../ui/Label"

export function DeckSpreadsheetImportPage() {
  const { deckId } = useParams({ from: "/(app)/decks/$deckId/import" })
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spreadsheetImport = trpc.deckSpreadsheet.getImport.useQuery(
    { id: importId ?? "" },
    {
      enabled: !!importId,
      refetchInterval: ({ state }) => {
        const status = state.data?.status
        return status && ["UPLOADED", "IMPORTING"].includes(status) ? 3_000 : false
      },
    }
  )

  const status = spreadsheetImport.data?.status
  const succeeded = status === "SUCCEEDED"

  const submit = async () => {
    if (!file) return

    setPending(true)
    setError(null)

    const isZip = file.name.toLowerCase().endsWith(".zip")

    try {
      const formData = new FormData()
      formData.set("file", file)

      const response = await fetch(
        isZip ? "/api/decks/spreadsheet/import-archive" : `/api/decks/${deckId}/spreadsheet/import`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        }
      )

      const payload = (await response.json().catch(() => null)) as {
        importId?: string
        batchId?: string
        message?: string
      } | null

      if (isZip) {
        if (!response.ok || !payload?.batchId) {
          throw new Error(payload?.message ?? "Could not read the zip archive.")
        }
        navigate({
          to: "/imports/spreadsheet-batch",
          search: { batchId: payload.batchId, deckId },
        })
        return
      }

      if (!response.ok || !payload?.importId) {
        throw new Error(payload?.message ?? "Could not upload the spreadsheet.")
      }

      setImportId(payload.importId)
      await utils.deckSpreadsheet.getImport.invalidate()
      await utils.decks.get.invalidate({ id: deckId })
      await utils.decks.list.invalidate()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Import spreadsheet" onBack={() => router.history.back()} />

      <div className="space-y-2">
        <Label htmlFor="spreadsheet-file">Spreadsheet file</Label>
        <input
          ref={inputRef}
          id="spreadsheet-file"
          type="file"
          accept=".xlsx,.zip"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={pending || !!importId}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending || !!importId}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="h-6 w-6" />
          <span className="font-medium text-foreground">
            {file ? "Choose a different file" : "Tap to choose a file"}
          </span>
          <span className="text-xs">
            A single <code>.xlsx</code> file, or a <code>.zip</code> of several. Up to 20MB.
          </span>
        </button>
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
          </div>
        </div>
      )}

      {spreadsheetImport.data && (
        <div className="space-y-2 rounded-md border bg-card p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Status</span>
            <span>{spreadsheetImport.data.status.toLowerCase()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold">{spreadsheetImport.data.createdCardCount}</p>
              <p className="text-xs text-muted-foreground">created</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{spreadsheetImport.data.updatedCardCount}</p>
              <p className="text-xs text-muted-foreground">updated</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{spreadsheetImport.data.deletedCardCount}</p>
              <p className="text-xs text-muted-foreground">deleted</p>
            </div>
          </div>
          {spreadsheetImport.data.errorSummary && (
            <p className="text-sm text-destructive">{spreadsheetImport.data.errorSummary}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="mt-auto space-y-2">
        {succeeded && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              utils.decks.get.invalidate({ id: deckId })
              utils.decks.list.invalidate()
              navigate({ to: "/decks/$deckId", params: { deckId } })
            }}
          >
            Back to deck
          </Button>
        )}
        <Button className="w-full" onClick={submit} disabled={!file || pending || !!importId}>
          <Upload className="mr-2 h-4 w-4" />
          {pending ? "Uploading..." : "Upload spreadsheet"}
        </Button>
      </div>
    </div>
  )
}
