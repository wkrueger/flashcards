import { BookOpen } from "lucide-react"
import { Card, CardContent } from "../../../ui/Card"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const ACCENT = "hsl(262 72% 60%)"

export function BookProgressChart({
  data,
}: {
  data: { date: string | Date; pagesRead: number }[]
}) {
  const max = Math.max(1, ...data.map((d) => d.pagesRead))
  return (
    <Card
      className="relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(168deg, ${ACCENT.replace(")", " / 0.18)")} 0%, ${ACCENT.replace(
          ")",
          " / 0.18)"
        )} 8%, transparent 22%)`,
      }}
    >
      <BookOpen
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-4 h-40 w-40 rotate-[18deg] opacity-25 dark:opacity-30"
        style={{ color: ACCENT }}
      />
      <CardContent className="relative space-y-2 p-3">
        <h2
          className="text-sm"
          style={{
            fontFamily: '"Quicksand", system-ui, sans-serif',
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: ACCENT,
          }}
        >
          Pages per day
        </h2>
        <div className="flex h-24 items-stretch gap-2">
          {data.map((d) => {
            const date = new Date(d.date)
            const heightPct = (d.pagesRead / max) * 100
            return (
              <div
                key={date.toISOString()}
                className="grid h-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-1"
              >
                <span className="block text-center text-[10px] font-medium leading-none text-muted-foreground">
                  {d.pagesRead > 0 ? d.pagesRead : ""}
                </span>
                <div className="flex min-h-0 w-full items-end">
                  <div
                    className="w-full rounded-t transition-[height]"
                    style={{
                      backgroundColor: ACCENT,
                      height: `${heightPct}%`,
                      minHeight: d.pagesRead > 0 ? "2px" : "0",
                    }}
                  />
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
