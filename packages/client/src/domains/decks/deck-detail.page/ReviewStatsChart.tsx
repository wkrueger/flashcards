import { Flame } from "lucide-react"
import { Card, CardContent } from "../../../ui/card"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatCardMinutes(minutes: number) {
  if (minutes <= 0) return "0"
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function formatCardsPerDay(cardCount: number, cardMinutes: number) {
  if (cardCount <= 0 || cardMinutes <= 0) return ""
  const days = cardMinutes / (24 * 60)
  return `${(days / cardCount).toFixed(1)}x`
}

export function ReviewStatsChart({
  data,
}: {
  data: { date: string | Date; cardMinutes: number; cardCount: number }[]
}) {
  const max = Math.max(1, ...data.map((d) => d.cardMinutes))
  return (
    <Card
      className="relative overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(168deg, hsl(28 92% 56% / 0.18) 0%, hsl(28 92% 56% / 0.18) 8%, transparent 22%)",
      }}
    >
      <Flame
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-4 h-40 w-40 rotate-[18deg] opacity-25 dark:opacity-30"
        style={{ color: "hsl(28 92% 56%)" }}
      />
      <CardContent className="relative space-y-2 p-3">
        <h2
          className="text-sm"
          style={{
            fontFamily: '"Quicksand", system-ui, sans-serif',
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "hsl(28 92% 56%)",
          }}
        >
          Card x time
        </h2>
        <div className="flex h-24 items-stretch gap-2">
          {data.map((d) => {
            const date = new Date(d.date)
            const heightPct = (d.cardMinutes / max) * 100
            const ratioLabel = formatCardsPerDay(d.cardCount, d.cardMinutes)
            const hasRatioLabel = ratioLabel.length > 0
            const showRatioInside = hasRatioLabel && heightPct >= 38
            return (
              <div
                key={date.toISOString()}
                className="grid h-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-1"
              >
                <div className="space-y-1">
                  <span className="block text-center text-[10px] font-medium leading-none text-muted-foreground">
                    {d.cardMinutes > 0 ? formatCardMinutes(d.cardMinutes) : ""}
                  </span>
                  {hasRatioLabel && !showRatioInside && (
                    <span className="block text-center text-[9px] font-medium leading-none text-muted-foreground">
                      {ratioLabel}
                    </span>
                  )}
                </div>
                <div className="flex min-h-0 w-full items-end">
                  <div
                    className="relative w-full rounded-t transition-[height]"
                    style={{
                      backgroundColor: "hsl(28 92% 56%)",
                      height: `${heightPct}%`,
                      minHeight: d.cardMinutes > 0 ? "2px" : "0",
                    }}
                  >
                    {showRatioInside && (
                      <span className="absolute inset-x-0 top-1 text-center text-[9px] font-semibold leading-none text-white/90">
                        {ratioLabel}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-center text-[10px] leading-none text-muted-foreground">
                  {DAY_LABELS[date.getUTCDay()]}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
