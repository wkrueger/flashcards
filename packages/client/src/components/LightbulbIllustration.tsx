import type { CSSProperties } from "react"
import { cn } from "../Lib/Utils"

export function LightbulbIllustration({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={cn(className)} style={style}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M50 12c-13 0-22 9-22 21 0 8 4 13 9 18 3 3 4 6 4 10v3h18v-3c0-4 1-7 4-10 5-5 9-10 9-18 0-12-9-21-22-21z" />
        <path d="M41 70h18" />
        <path d="M43 76h14" />
        <path d="M46 82h8" />
        <g opacity="0.6">
          <path d="M50 4v6" />
          <path d="M78 14l-4 4" />
          <path d="M88 36h-6" />
          <path d="M22 14l4 4" />
          <path d="M12 36h6" />
        </g>
      </g>
      <path
        d="M44 44c0-3 3-6 6-6s6 3 6 6c0 3-3 5-3 8h-6c0-3-3-5-3-8z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  )
}
