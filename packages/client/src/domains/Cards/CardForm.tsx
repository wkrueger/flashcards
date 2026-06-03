import { ChangeEvent, useEffect, useRef, useState } from "react"
import { Button } from "../../ui/Button"
import { Card, CardContent } from "../../ui/Card"
import { Label } from "../../ui/Label"
import { SubjectAutocomplete } from "./SubjectAutocomplete"

export interface CardFormValues {
  subjectText: string
  front: string
  back: string
}

export function CardForm({
  deckId,
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  deckId: string
  initial: CardFormValues
  submitLabel: string
  pending: boolean
  error: string | null
  onSubmit: (v: CardFormValues) => void
}) {
  const [subjectText, setSubjectText] = useState(initial.subjectText)
  const [front, setFront] = useState(initial.front)
  const [back, setBack] = useState(initial.back)

  useEffect(() => {
    setSubjectText(initial.subjectText)
    setFront(initial.front)
    setBack(initial.back)
  }, [initial.subjectText, initial.front, initial.back])

  return (
    <form
      className="flex flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          subjectText: subjectText.trim(),
          front: front.trim(),
          back: back.trim(),
        })
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Subject</Label>
        <SubjectAutocomplete deckId={deckId} value={subjectText} onChange={setSubjectText} />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <CardBodyField id="front" label="Front" value={front} onChange={setFront} autoFocus />
          <CardBodyField id="back" label="Back" value={back} onChange={setBack} bordered />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        className="mt-auto w-full"
        disabled={pending || !subjectText || !front || !back}
      >
        {pending ? "…" : submitLabel}
      </Button>
    </form>
  )
}

function CardBodyField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  bordered,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  bordered?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <div className={bordered ? "border-t pt-3" : undefined}>
      <Label
        htmlFor={id}
        className="mb-1 block text-xs font-semibold uppercase text-muted-foreground"
      >
        {label}
      </Label>
      <textarea
        ref={ref}
        id={id}
        rows={2}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        autoFocus={autoFocus}
        className="block w-full resize-none border-0 bg-transparent p-0 text-lg leading-7 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        required
      />
    </div>
  )
}
