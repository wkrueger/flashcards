import { ArrowLeft } from "lucide-react"
import { Button } from "../../../ui/Button"

// Back (icon only), progress, and the primary reveal/next action all share one
// bar. The primary button is never disabled — advancing must not wait on a
// translation that is still in flight.
export function ReaderBottomBar({
  pageIndex,
  pageCount,
  canGoBack,
  primaryLabel,
  onBack,
  onPrimary,
}: {
  pageIndex: number
  pageCount: number
  canGoBack: boolean
  primaryLabel: string
  onBack: () => void
  onPrimary: () => void
}) {
  return (
    <div className="mt-auto flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous page"
        className="shrink-0"
        disabled={!canGoBack}
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {pageIndex + 1} / {pageCount}
      </span>
      <Button className="flex-1" onClick={onPrimary}>
        {primaryLabel}
      </Button>
    </div>
  )
}
