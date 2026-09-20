import { useRef, useState } from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { BookUp, Upload } from "lucide-react"
import { PageHeader } from "../../components/AppShell"
import { Button } from "../../ui/Button"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"

async function uploadEpubFile(file: File, name: string) {
  const formData = new FormData()
  // The name goes first so the server sees it on the file part's fields.
  if (name.trim()) formData.set("name", name.trim())
  formData.set("file", file)

  const response = await fetch("/api/books/upload", {
    method: "POST",
    credentials: "include",
    body: formData,
  })

  const payload = (await response.json().catch(() => null)) as {
    bookId?: string
    message?: string
  } | null

  if (!response.ok || !payload?.bookId) {
    throw new Error(payload?.message ?? "Could not upload the EPUB file.")
  }

  return payload.bookId
}

export function BookUploadPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!file) return
    setPending(true)
    setError(null)
    try {
      const bookId = await uploadEpubFile(file, name)
      navigate({ to: "/books/$bookId", params: { bookId } })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Import EPUB" onBack={() => router.history.back()} />

      <div className="space-y-2">
        <Label htmlFor="epub-file">EPUB file</Label>
        <input
          ref={inputRef}
          id="epub-file"
          type="file"
          accept=".epub,application/epub+zip"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 w-full justify-start gap-2 whitespace-normal break-words py-2 text-left"
          onClick={() => inputRef.current?.click()}
        >
          <BookUp className="h-4 w-4 shrink-0" />
          {file ? file.name : "Choose an .epub file"}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="epub-name">Name (optional)</Label>
        <Input
          id="epub-name"
          value={name}
          maxLength={100}
          placeholder="Taken from the file when empty"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className="mt-auto w-full gap-2" disabled={!file || pending} onClick={submit}>
        <Upload className="h-4 w-4" />
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </div>
  )
}
