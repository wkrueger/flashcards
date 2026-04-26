import { useState } from "react"
import { Button } from "../../ui/button"
import { Label } from "../../ui/label"
import { Textarea } from "../../ui/textarea"
import { SubjectAutocomplete } from "./subject-autocomplete"

export interface CardFormValues {
  subjectText: string
  front: string
  back: string
}

export function CardForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  initial: CardFormValues
  submitLabel: string
  pending: boolean
  error: string | null
  onSubmit: (v: CardFormValues) => void
}) {
  const [subjectText, setSubjectText] = useState(initial.subjectText)
  const [front, setFront] = useState(initial.front)
  const [back, setBack] = useState(initial.back)

  return (
    <form
      className="flex flex-1 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          subjectText: subjectText.trim(),
          front: front.trim(),
          back: back.trim(),
        })
      }}
    >
      <div className="space-y-1">
        <Label>Subject</Label>
        <SubjectAutocomplete value={subjectText} onChange={setSubjectText} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="front">Front (markdown)</Label>
        <Textarea
          id="front"
          rows={4}
          value={front}
          onChange={(e) => setFront(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="back">Back (markdown)</Label>
        <Textarea
          id="back"
          rows={4}
          value={back}
          onChange={(e) => setBack(e.target.value)}
          required
        />
      </div>
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
