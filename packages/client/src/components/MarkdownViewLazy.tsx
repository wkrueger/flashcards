import { lazy, Suspense } from "react"

const LazyMarkdownView = lazy(() =>
  import("./MarkdownView").then((m) => ({ default: m.MarkdownView }))
)

export function MarkdownView({ source }: { source: string }) {
  return (
    <Suspense fallback={<MarkdownFallback source={source} />}>
      <LazyMarkdownView source={source} />
    </Suspense>
  )
}

function MarkdownFallback({ source }: { source: string }) {
  return (
    <div className="prose prose-lg max-w-none dark:prose-invert [&>*:first-child]:mt-0">
      <p className="text-lg leading-relaxed whitespace-pre-wrap">{source}</p>
    </div>
  )
}
