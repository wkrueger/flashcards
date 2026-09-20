import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { BookmarkPlus, LoaderCircle } from "lucide-react"
import { MenuItem, PageHeader } from "../../../components/AppShell"
import { MarkdownView } from "../../../components/MarkdownView"
import { handleTRPCError, trpc } from "../../../infra/trpc"
import { Button } from "../../../ui/Button"
import { Card, CardContent } from "../../../ui/Card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../ui/Dialog"
import { Input } from "../../../ui/Input"
import { Label } from "../../../ui/Label"
import { ReaderBottomBar } from "./ReaderBottomBar"

// How far ahead the reader warms the page cache. The server keeps a matching
// window of translations queued.
const PREFETCH_AHEAD = 2
const TRANSLATION_POLL_MS = 1500

export function BookReaderPage() {
  const { bookId } = useParams({ from: "/(app)/books/$bookId/read" })
  const { page } = useSearch({ from: "/(app)/books/$bookId/read" })
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const [revealed, setRevealed] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [bookmarkName, setBookmarkName] = useState("")

  const book = trpc.books.get.useQuery({ bookId })
  const currentPage = trpc.books.readPage.useQuery(
    { bookId, index: page },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.translationStatus
        return status === "PENDING" || status === "TRANSLATING" ? TRANSLATION_POLL_MS : false
      },
    }
  )

  const prefetchTranslations = trpc.books.prefetchTranslations.useMutation()
  const setProgress = trpc.books.setProgress.useMutation({
    onSuccess: () => utils.books.get.invalidate({ bookId }),
  })
  const retryTranslation = trpc.books.retryTranslation.useMutation({
    onSuccess: () => utils.books.readPage.invalidate({ bookId, index: page }),
    onError: handleTRPCError,
  })
  const createBookmark = trpc.books.createBookmark.useMutation({
    onSuccess: () => {
      utils.books.bookmarks.invalidate({ bookId })
      setBookmarkOpen(false)
      setBookmarkName("")
    },
    onError: handleTRPCError,
  })

  const pageCount = book.data?.pageCount ?? currentPage.data?.pageCount ?? 0

  useEffect(() => {
    setRevealed(false)
  }, [page])

  // Warm the next pages and keep the translation window ahead of the reader.
  // Both are fire-and-forget so a page turn never waits on them.
  const requestedFor = useRef<string | null>(null)
  const { mutate: requestTranslations } = prefetchTranslations
  const { mutate: reportProgress } = setProgress
  useEffect(() => {
    const key = `${bookId}:${page}`
    if (requestedFor.current === key) return
    requestedFor.current = key

    requestTranslations({ bookId, fromIndex: page })
    reportProgress({ bookId, pageIndex: page })
    for (let ahead = 1; ahead <= PREFETCH_AHEAD; ahead++) {
      const index = page + ahead
      if (pageCount > 0 && index >= pageCount) break
      utils.books.readPage.prefetch({ bookId, index })
    }
  }, [bookId, page, pageCount, requestTranslations, reportProgress, utils])

  const goToPage = (next: number) => {
    // `replace` keeps the browser's back button pointed at the book instead of
    // walking back through every page that was read.
    navigate({
      to: "/books/$bookId/read",
      params: { bookId },
      search: { page: next },
      replace: true,
    })
  }

  if (book.data && book.data.status !== "READY") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">This book is not ready to read yet.</p>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/books/$bookId", params: { bookId } })}
        >
          Back to book
        </Button>
      </div>
    )
  }

  const data = currentPage.data
  const isLastPage = pageCount > 0 && page >= pageCount - 1

  return (
    <div className="flex flex-1 flex-col gap-3 pb-3">
      <PageHeader
        subtitle={data?.chapterTitle ?? book.data?.title ?? undefined}
        onBack={() => navigate({ to: "/books/$bookId", params: { bookId } })}
        menuItems={
          <MenuItem
            onSelect={() => {
              setBookmarkName(data?.chapterTitle ?? `Page ${page + 1}`)
              setBookmarkOpen(true)
            }}
            icon={<BookmarkPlus className="h-[18px] w-[18px]" />}
          >
            Add bookmark
          </MenuItem>
        }
      />

      <div key={page} className="contents [&>*]:animate-card-in">
        <Card>
          <CardContent className="min-h-[10rem] p-4">
            {data ? (
              <div className="font-serif">
                <MarkdownView source={data.markdown} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </CardContent>
        </Card>
      </div>

      {revealed && (
        <Card className="animate-reveal">
          <CardContent className="min-h-[8rem] p-4">
            <TranslationBody
              translation={data?.translation ?? null}
              status={data?.translationStatus ?? "PENDING"}
              error={data?.translationError ?? null}
              retrying={retryTranslation.isPending}
              onRetry={() => retryTranslation.mutate({ bookId, index: page })}
            />
          </CardContent>
        </Card>
      )}

      <ReaderBottomBar
        pageIndex={page}
        pageCount={Math.max(pageCount, page + 1)}
        canGoBack={page > 0}
        primaryLabel={revealed ? (isLastPage ? "Finish" : "Next") : "Reveal"}
        onBack={() => goToPage(Math.max(0, page - 1))}
        onPrimary={() => {
          if (!revealed) {
            setRevealed(true)
            return
          }
          if (isLastPage) {
            navigate({ to: "/books/$bookId", params: { bookId } })
            return
          }
          goToPage(page + 1)
        }}
      />

      <Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add bookmark</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!bookmarkName.trim()) return
              createBookmark.mutate({ bookId, pageIndex: page, name: bookmarkName.trim() })
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="bookmark-name">Name</Label>
              <Input
                id="bookmark-name"
                value={bookmarkName}
                autoFocus
                onChange={(event) => setBookmarkName(event.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={createBookmark.isPending}>
              {createBookmark.isPending ? "Saving…" : `Bookmark page ${page + 1}`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TranslationBody({
  translation,
  status,
  error,
  retrying,
  onRetry,
}: {
  translation: string | null
  status: "PENDING" | "TRANSLATING" | "DONE" | "FAILED"
  error: string | null
  retrying: boolean
  onRetry: () => void
}) {
  if (translation)
    return (
      <div className="font-serif">
        <MarkdownView source={translation} />
      </div>
    )

  if (status === "FAILED") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error ?? "The translation failed."}</p>
        <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </div>
    )
  }

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      Translating…
    </p>
  )
}
