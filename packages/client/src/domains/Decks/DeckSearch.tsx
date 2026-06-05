import { Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../ui/Button"

export function DeckSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function close() {
    setOpen(false)
    onChange("")
  }

  return (
    <div className="flex items-center">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && close()}
        placeholder="Search decks"
        aria-label="Search decks"
        className={`h-7 rounded-full bg-transparent text-xs outline-none transition-all duration-200 ${
          open ? "w-32 px-2 opacity-100" : "w-0 px-0 opacity-0"
        }`}
        tabIndex={open ? 0 : -1}
      />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 px-2"
        aria-label={open ? "Close search" : "Search decks"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </Button>
    </div>
  )
}
