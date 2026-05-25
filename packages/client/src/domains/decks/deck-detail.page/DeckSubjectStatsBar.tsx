import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../../lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover"

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
  const containerRef = useRef<HTMLButtonElement | null>(null)
  const labelRefs = useRef<Record<MarkerId, HTMLSpanElement | null>>({
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
        priority: 2,
      },
      {
        id: "unseen",
        label: "unseen",
        count: clampedUnseen,
        percent: percentOf(clampedUnseen, subjectCount),
        priority: 1,
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={containerRef}
          type="button"
          className="block w-full space-y-2 rounded-md text-left outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="deck-subject-stats"
        >
          <span className="sr-only">{summary}</span>
          <span aria-hidden="true" className="relative block pt-12">
            {markers.map((marker) => {
              const visible = visibleMarkerIds.includes(marker.id)
              return (
                <span
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
                </span>
              )
            })}

            <span className="relative block">
              {markers.map((marker) => (
                <span
                  key={marker.id}
                  className="absolute -top-2 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-foreground"
                  style={{ left: `${marker.percent}%`, transform: "translateX(-50%)" }}
                />
              ))}
              <span className="flex h-2 overflow-hidden rounded-full bg-muted">
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
              </span>
            </span>
          </span>
          <span className="block text-center text-sm text-muted-foreground">
            {formatCount(subjectCount, "subject")}, {formatCount(cardCount, "card")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={10} className="group w-72 p-4">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 hidden h-3 w-3 -translate-x-1/2 rotate-45 bg-popover group-data-[side=bottom]:-top-[7px] group-data-[side=bottom]:block group-data-[side=bottom]:border-l group-data-[side=bottom]:border-t group-data-[side=top]:-bottom-[7px] group-data-[side=top]:block group-data-[side=top]:border-b group-data-[side=top]:border-r"
        />
        <h3 className="mb-3 text-sm font-semibold">Deck stats</h3>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Subjects</dt>
            <dd className="font-medium tabular-nums">{subjectCount}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Cards</dt>
            <dd className="font-medium tabular-nums">{cardCount}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Unseen</dt>
            <dd className="font-medium tabular-nums">{clampedUnseen}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Due now</dt>
            <dd className="font-medium tabular-nums">{clampedDue}</dd>
          </div>
          {dueIn24h !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Due within 24 hours</dt>
              <dd className="font-medium tabular-nums">{clampCount(dueIn24h, subjectCount)}</dd>
            </div>
          )}
          {dueIn48h !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Due within 48 hours</dt>
              <dd className="font-medium tabular-nums">{clampCount(dueIn48h, subjectCount)}</dd>
            </div>
          )}
        </dl>
      </PopoverContent>
    </Popover>
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
