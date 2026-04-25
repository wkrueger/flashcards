import { useState } from "react"
import { trpc } from "../../infra/trpc"
import { Input } from "../../ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover"

export function SubjectAutocomplete({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const suggestions = trpc.subjects.autocomplete.useQuery(
    { query: value.trim() },
    { enabled: focused && value.trim().length > 0 }
  )

  const open =
    focused &&
    !!suggestions.data &&
    suggestions.data.length > 0 &&
    !suggestions.data.some((s) => s.subject === value)

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Input
          value={value}
          placeholder="Subject (e.g. Haus)"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="space-y-0.5">
          {suggestions.data?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(s.subject)
                  setFocused(false)
                }}
              >
                {s.subject}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
