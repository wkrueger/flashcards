import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../../lib/utils"

type MarkerId = "due" | "unseen" | "24h" | "48h"

interface Marker {
  id: MarkerId
  label: string
  count: number
  percent: number
  priority: number
}

interface DeckSubjectStatsBarProps {
  cardCount: number
  subjectCount: number
  unseenCount: number
  dueCount: number
  dueIn24h?: number
  dueIn48h?: number
}

const LABEL_GAP_PX = 6

export function DeckSubjectStatsBar({
  cardCount,
  subjectCount,
  unseenCount,
  dueCount,
  dueIn24h,
  dueIn48h,
}: DeckSubjectStatsBarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Record<MarkerId, HTMLDivElement | null>>({
    due: null,
    unseen: null,
    "24h": null,
    "48h": null,
  })
  const [measureTick, setMeasureTick] = useState(0)
  const [visibleMarkerIds, setVisibleMarkerIds] = useState<MarkerId[]>([])
  const hasSubjects = subjectCount > 0
  const clampedUnseen = clampCount(unseenCount, subjectCount)
  const clampedDue = clampCount(dueCount, subjectCount)
  const dueBoundary = Math.max(clampedUnseen, clampedDue)

  const segments = [
    { id: "unseen", width: percentOf(clampedUnseen, subjectCount), className: "bg-muted" },
    {
      id: "due",
      width: percentOf(Math.max(0, dueBoundary - clampedUnseen), subjectCount),
      className: "bg-primary",
    },
    {
      id: "remaining",
      width: percentOf(Math.max(0, subjectCount - dueBoundary), subjectCount),
      className: "bg-accent",
    },
  ]

  const markers = useMemo<Marker[]>(() => {
    if (!hasSubjects) return []

    const result: Marker[] = [
      {
        id: "due",
        label: "due",
        count: clampedDue,
        percent: percentOf(clampedDue, subjectCount),
        priority: 1,
      },
      {
        id: "unseen",
        label: "unseen",
        count: clampedUnseen,
        percent: percentOf(clampedUnseen, subjectCount),
        priority: 2,
      },
    ]

    if (dueIn24h !== undefined) {
      const count = clampCount(dueIn24h, subjectCount)
      result.push({
        id: "24h",
        label: "24h",
        count,
        percent: percentOf(count, subjectCount),
        priority: 3,
      })
    }

    if (dueIn48h !== undefined) {
      const count = clampCount(dueIn48h, subjectCount)
      result.push({
        id: "48h",
        label: "48h",
        count,
        percent: percentOf(count, subjectCount),
        priority: 4,
      })
    }

    return result
  }, [clampedDue, clampedUnseen, dueIn24h, dueIn48h, hasSubjects, subjectCount])

  useLayoutEffect(() => {
    if (markers.length === 0) {
      setVisibleMarkerIds([])
      return
    }

    const kept: Marker[] = []
    const visible = markers
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .filter((marker) => {
        const rect = labelRefs.current[marker.id]?.getBoundingClientRect()
        if (!rect) return false
        const overlaps = kept.some((keptMarker) => {
          const keptRect = labelRefs.current[keptMarker.id]?.getBoundingClientRect()
          return keptRect ? rectsOverlap(rect, keptRect, LABEL_GAP_PX) : false
        })
        if (overlaps) return false
        kept.push(marker)
        return true
      })
      .map((marker) => marker.id)

    setVisibleMarkerIds((current) => (sameIds(current, visible) ? current : visible))
  }, [markers, measureTick])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => setMeasureTick((current) => current + 1)
      window.addEventListener("resize", handleResize)
      handleResize()
      return () => window.removeEventListener("resize", handleResize)
    }

    const observer = new ResizeObserver(() => setMeasureTick((current) => current + 1))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const summary = buildSummary({
    cardCount,
    subjectCount,
    unseenCount: clampedUnseen,
    dueCount: clampedDue,
    dueIn24h,
    dueIn48h,
  })

  return (
    <div ref={containerRef} className="space-y-2" data-testid="deck-subject-stats">
      <p className="sr-only">{summary}</p>
      <div aria-hidden="true" className="relative pt-12">
        {markers.map((marker) => {
          const visible = visibleMarkerIds.includes(marker.id)
          return (
            <div
              key={marker.id}
              ref={(node) => {
                labelRefs.current[marker.id] = node
              }}
              className={cn(
                "absolute top-0 min-w-10 text-center transition-opacity",
                visible ? "opacity-100" : "opacity-0"
              )}
              style={{
                left: `${marker.percent}%`,
                transform: labelTransform(marker.percent),
              }}
            >
              <span className="block text-sm font-semibold leading-none tabular-nums">
                {marker.count}
              </span>
              <span className="mt-1 block text-[10px] font-medium uppercase leading-none text-muted-foreground">
                {marker.label}
              </span>
            </div>
          )
        })}

        <div className="relative">
          {markers.map((marker) => (
            <span
              key={marker.id}
              className="absolute -top-2 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-foreground"
              style={{ left: `${marker.percent}%`, transform: "translateX(-50%)" }}
            />
          ))}
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {hasSubjects ? (
              segments.map((segment) => (
                <span
                  key={segment.id}
                  className={cn("h-full", segment.className)}
                  style={{ width: `${segment.width}%` }}
                />
              ))
            ) : (
              <span className="h-full w-full bg-muted" />
            )}
          </div>
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {formatCount(subjectCount, "subject")}, {formatCount(cardCount, "card")}
      </p>
    </div>
  )
}

function clampCount(count: number, total: number) {
  if (total <= 0) return 0
  return Math.min(Math.max(count, 0), total)
}

function percentOf(count: number, total: number) {
  if (total <= 0) return 0
  return (count / total) * 100
}

function labelTransform(percent: number) {
  if (percent <= 3) return "translateX(0)"
  if (percent >= 97) return "translateX(-100%)"
  return "translateX(-50%)"
}

function rectsOverlap(a: DOMRect, b: DOMRect, gap: number) {
  return a.left - gap < b.right && a.right + gap > b.left
}

function sameIds(a: MarkerId[], b: MarkerId[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function buildSummary({
  cardCount,
  subjectCount,
  unseenCount,
  dueCount,
  dueIn24h,
  dueIn48h,
}: {
  cardCount: number
  subjectCount: number
  unseenCount: number
  dueCount: number
  dueIn24h?: number
  dueIn48h?: number
}) {
  const parts = [
    `Deck contains ${formatCount(subjectCount, "subject")} and ${formatCount(cardCount, "card")}.`,
    `${formatCount(unseenCount, "subject")} unseen.`,
    `${formatCount(dueCount, "subject")} due now.`,
  ]

  if (dueIn24h !== undefined) {
    parts.push(`${formatCount(clampCount(dueIn24h, subjectCount), "subject")} due within 24 hours.`)
  }

  if (dueIn48h !== undefined) {
    parts.push(`${formatCount(clampCount(dueIn48h, subjectCount), "subject")} due within 48 hours.`)
  }

  return parts.join(" ")
}
