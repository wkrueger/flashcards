import { Check } from "lucide-react"
import { cn } from "../Lib/Utils"

interface CheckboxProps {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function Checkbox({ id, checked, onChange, className }: CheckboxProps) {
  return (
    <label className={cn("relative flex cursor-pointer items-center", className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground"
      >
        <Check className="h-4 w-4" />
      </span>
    </label>
  )
}

interface CheckboxCardProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}

export function CheckboxCard({
  checked,
  onChange,
  label,
  description,
  disabled,
}: CheckboxCardProps) {
  return (
    <label
      className={cn(
        "flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-accent/40"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground"
      >
        <Check className="h-4 w-4" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </label>
  )
}
