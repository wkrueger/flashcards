import { useRef, useState } from "react"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { Upload, FileArchive, List } from "lucide-react"
import { PageHeader } from "../../components/AppShell"
import { Button, buttonVariants } from "../../ui/button"
import { Label } from "../../ui/label"
import { cn } from "../../lib/utils"

async function uploadAnkiFile(file: File) {
  const formData = new FormData()
  formData.set("file", file)

  const response = await fetch("/api/imports/anki/upload", {
    method: "POST",
    credentials: "include",
    body: formData,
  })

  const payload = (await response.json().catch(() => null)) as {
    processId?: string
    message?: string
  } | null

  if (!response.ok || !payload?.processId) {
    throw new Error(payload?.message ?? "Could not upload the Anki file.")
  }

  return payload
}

export function AnkiImportUploadPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!file) return

    setPending(true)
    setError(null)

    try {
      const result = await uploadAnkiFile(file)
      navigate({
        to: "/imports/anki/$processId",
        params: { processId: result.processId! },
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Import Anki"
        onBack={() => router.history.back()}
        actions={
          <Link
            to="/imports/anki"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-3")}
          >
            <List className="h-4 w-4" />
            All imports
          </Link>
        }
      />

      <div className="space-y-2">
        <Label htmlFor="anki-file">Anki package</Label>
        <input
          ref={inputRef}
          id="anki-file"
          type="file"
          accept=".apkg"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-muted/40"
        >
          <Upload className="h-6 w-6" />
          <span className="font-medium text-foreground">
            {file ? "Choose a different file" : "Tap to choose a file"}
          </span>
          <span className="text-xs">
            Single <code>.apkg</code> file, up to 300MB.
          </span>
        </button>
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <FileArchive className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className="mt-auto w-full" onClick={submit} disabled={!file || pending}>
        <Upload className="mr-2 h-4 w-4" />
        {pending ? "Uploading…" : "Upload and analyze"}
      </Button>
    </div>
  )
}
