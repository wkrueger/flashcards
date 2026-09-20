import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

export function BookChapterList({
  bookId,
  chapters,
  currentPageIndex,
}: {
  bookId: string
  chapters: { id: string; title: string; startPageIndex: number }[]
  currentPageIndex: number
}) {
  if (chapters.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Chapters</h2>
      <ul className="divide-y rounded-md border bg-card">
        {chapters.map((chapter, i) => {
          const next = chapters[i + 1]
          const isCurrent =
            currentPageIndex >= chapter.startPageIndex &&
            (next === undefined || currentPageIndex < next.startPageIndex)
          return (
            <li key={chapter.id}>
              <Link
                to="/books/$bookId/read"
                params={{ bookId }}
                search={{ page: chapter.startPageIndex }}
                className="flex items-center gap-2 px-3 py-2.5 text-sm transition hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                {isCurrent && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    reading
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  p. {chapter.startPageIndex + 1}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
