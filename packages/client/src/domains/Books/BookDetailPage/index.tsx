import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { BookOpen, LoaderCircle, Pencil, Trash2 } from "lucide-react"
import { MenuItem, PageHeader } from "../../../components/AppShell"
import { LanguageSelect } from "../../../components/LanguageSelect"
import { handleTRPCError, trpc } from "../../../infra/trpc"
import { Button, buttonVariants } from "../../../ui/Button"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../../ui/Dialog"
import { Input } from "../../../ui/Input"
import { Label } from "../../../ui/Label"
import { cn } from "../../../Lib/Utils"
import { BookBookmarkList } from "./BookBookmarkList"
import { BookChapterList } from "./BookChapterList"
import { BookProgressChart } from "./BookProgressChart"

// While the worker is still splitting the EPUB there is nothing to show yet, so
// the page polls until the book turns READY (or FAILED).
const PARSING_POLL_MS = 1500

export function BookDetailPage() {
  const { bookId } = useParams({ from: "/(app)/books/$bookId" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const book = trpc.books.get.useQuery(
    { bookId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status
        return status === "UPLOADED" || status === "PARSING" ? PARSING_POLL_MS : false
      },
    }
  )
  const isReady = book.data?.status === "READY"
  const chapters = trpc.books.chapters.useQuery({ bookId }, { enabled: isReady })
  const bookmarks = trpc.books.bookmarks.useQuery({ bookId }, { enabled: isReady })
  const readingStats = trpc.books.readingStats.useQuery({ bookId }, { enabled: isReady })

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [sourceLanguageId, setSourceLanguageId] = useState("")
  const [targetLanguageId, setTargetLanguageId] = useState("")

  useEffect(() => {
    if (!editOpen || !book.data) return
    setEditTitle(book.data.title)
    setSourceLanguageId(book.data.sourceLanguageId ? String(book.data.sourceLanguageId) : "")
    setTargetLanguageId(book.data.targetLanguageId ? String(book.data.targetLanguageId) : "")
  }, [editOpen, book.data])

  const update = trpc.books.update.useMutation({
    onSuccess: () => {
      utils.books.get.invalidate({ bookId })
      utils.decks.list.invalidate()
      setEditOpen(false)
    },
    onError: handleTRPCError,
  })
  const remove = trpc.books.delete.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate()
      navigate({ to: "/" })
    },
    onError: handleTRPCError,
  })

  if (book.isLoading) return <p></p>
  if (!book.data) return <p className="text-sm text-muted-foreground">Book not found.</p>

  const data = book.data
  const startPage = Math.min(data.currentPageIndex, Math.max(0, data.pageCount - 1))

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title={data.title}
        onBack={() => navigate({ to: "/" })}
        titleAdornment={<BookOpen className="h-4 w-4 text-muted-foreground" />}
        menuItems={
          <>
            <MenuItem
              onSelect={() => setEditOpen(true)}
              icon={<Pencil className="h-[18px] w-[18px]" />}
            >
              Edit book
            </MenuItem>
            <MenuItem
              onSelect={() => setDeleteOpen(true)}
              icon={<Trash2 className="h-[18px] w-[18px]" />}
            >
              Delete book
            </MenuItem>
          </>
        }
      />

      {data.author && <p className="-mt-2 text-sm text-muted-foreground">{data.author}</p>}

      {data.status === "FAILED" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">This EPUB could not be read.</p>
          {data.errorSummary && <p className="mt-1 text-muted-foreground">{data.errorSummary}</p>}
        </div>
      ) : !isReady ? (
        <div className="flex items-center gap-2 rounded-md border bg-card p-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Preparing the book…
        </div>
      ) : (
        <>
          <section className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Progress</span>
              <span className="text-muted-foreground">
                {data.furthestPageIndex + 1} / {data.pageCount} · {data.progressPercent}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${data.progressPercent}%` }}
              />
            </div>
          </section>

          <Link
            to="/books/$bookId/read"
            params={{ bookId }}
            search={{ page: startPage }}
            className={cn(buttonVariants({ variant: "default" }), "w-full gap-2")}
          >
            <BookOpen className="h-4 w-4" />
            Continue reading
          </Link>

          {readingStats.data && <BookProgressChart data={readingStats.data} />}

          <BookChapterList
            bookId={bookId}
            chapters={chapters.data ?? []}
            currentPageIndex={data.currentPageIndex}
          />

          <BookBookmarkList bookId={bookId} bookmarks={bookmarks.data ?? []} />
        </>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit book</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!editTitle.trim()) return
              update.mutate({
                bookId,
                title: editTitle.trim(),
                sourceLanguageId: sourceLanguageId ? Number(sourceLanguageId) : null,
                targetLanguageId: targetLanguageId ? Number(targetLanguageId) : null,
              })
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="book-title">Title</Label>
              <Input
                id="book-title"
                value={editTitle}
                autoFocus
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Book language (optional)</Label>
              <LanguageSelect
                value={sourceLanguageId}
                onChange={setSourceLanguageId}
                placeholder="Detect from the file"
              />
            </div>
            <div className="space-y-1">
              <Label>Translate into (optional)</Label>
              <LanguageSelect value={targetLanguageId} onChange={setTargetLanguageId} />
              <p className="text-xs text-muted-foreground">
                Changing this clears the translations already made for this book.
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" className="flex-1" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this book?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The book, its pages, bookmarks and reading history are removed permanently.
          </p>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ bookId })}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
