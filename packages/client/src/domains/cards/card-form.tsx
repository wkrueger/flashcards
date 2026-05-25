import { useEffect, useState } from "react"
import { Button } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { Label } from "../../ui/label"
import { Textarea } from "../../ui/textarea"
import { SubjectAutocomplete } from "./subject-autocomplete"

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
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Subject</Label>
            <SubjectAutocomplete deckId={deckId} value={subjectText} onChange={setSubjectText} />
          </div>
          <div className="space-y-1.5 border-t pt-4">
            <Label
              htmlFor="front"
              className="text-xs font-semibold uppercase text-muted-foreground"
            >
              Front (markdown)
            </Label>
            <Textarea
              id="front"
              rows={4}
              value={front}
              onChange={(e) => setFront(e.target.value)}
              className="min-h-32 resize-y text-lg leading-7"
              required
            />
          </div>
          <div className="space-y-1.5 border-t pt-4">
            <Label htmlFor="back" className="text-xs font-semibold uppercase text-muted-foreground">
              Back (markdown)
            </Label>
            <Textarea
              id="back"
              rows={4}
              value={back}
              onChange={(e) => setBack(e.target.value)}
              className="min-h-32 resize-y text-lg leading-7"
              required
            />
          </div>
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
