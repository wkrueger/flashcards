import { ChevronDown } from "lucide-react"
import { cn } from "../lib/utils"

export interface NativeSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface Props {
  value: string
  onChange: (next: string) => void
  options: NativeSelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function NativeSelect({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  disabled,
  className,
  ariaLabel,
}: Props) {
  const selected = options.find((o) => o.value === value)
  return (
    <div
      className={cn(
        "relative rounded-md ring-offset-background has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
        className
      )}
    >
      <div
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span className={cn("line-clamp-1", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </div>
      <select
        aria-label={ariaLabel ?? placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      >
        {!selected && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
