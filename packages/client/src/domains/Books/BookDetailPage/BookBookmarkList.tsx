import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Bookmark, Check, Pencil, Trash2, X } from "lucide-react"
import { handleTRPCError, trpc } from "../../../infra/trpc"
import { Button } from "../../../ui/Button"
import { Input } from "../../../ui/Input"

export function BookBookmarkList({
  bookId,
  bookmarks,
}: {
  bookId: string
  bookmarks: { id: string; name: string; pageIndex: number }[]
}) {
  const utils = trpc.useUtils()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")

  const invalidate = () => {
    utils.books.bookmarks.invalidate({ bookId })
    utils.books.get.invalidate({ bookId })
  }
  const rename = trpc.books.renameBookmark.useMutation({
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    },
    onError: handleTRPCError,
  })
  const remove = trpc.books.deleteBookmark.useMutation({
    onSuccess: invalidate,
    onError: handleTRPCError,
  })

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Bookmarks</h2>
      {bookmarks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bookmarks yet — add one from the reader menu.
        </p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="flex items-center gap-1 px-3 py-2">
              {editingId === bookmark.id ? (
                <>
                  <Input
                    value={draftName}
                    autoFocus
                    className="h-8"
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Save bookmark name"
                    className="h-8 w-8 shrink-0"
                    disabled={!draftName.trim() || rename.isPending}
                    onClick={() => rename.mutate({ id: bookmark.id, name: draftName.trim() })}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel rename"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Link
                    to="/books/$bookId/read"
                    params={{ bookId }}
                    search={{ page: bookmark.pageIndex }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-sm"
                  >
                    <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{bookmark.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      p. {bookmark.pageIndex + 1}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Rename ${bookmark.name}`}
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      setEditingId(bookmark.id)
                      setDraftName(bookmark.name)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${bookmark.name}`}
                    className="h-8 w-8 shrink-0"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: bookmark.id })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
