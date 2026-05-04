import { lazy, Suspense } from "react"

const LazyMarkdownView = lazy(() =>
  import("./MarkdownView").then((m) => ({ default: m.MarkdownView }))
)

export function MarkdownView({ source }: { source: string }) {
  return (
    <Suspense fallback={<MarkdownFallback />}>
      <LazyMarkdownView source={source} />
    </Suspense>
  )
}

function MarkdownFallback() {
  return null
}
