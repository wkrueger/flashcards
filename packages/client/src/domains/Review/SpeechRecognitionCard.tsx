import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { CircleStop, Mic, RotateCcw } from "lucide-react"
import { Button } from "../../ui/button"
import { Card, CardContent } from "../../ui/card"
import { cn } from "../../lib/utils"

type SpeechRecognitionState = "idle" | "recording" | "stopped" | "unsupported"

type SpeechRecognitionAvailability = "available" | "downloading" | "downloadable" | "unavailable"

type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionLike
  available?: (options: {
    langs: string[]
    processLocally: boolean
  }) => Promise<SpeechRecognitionAvailability>
}

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionResultLike = {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike | undefined
}

type SpeechRecognitionResultListLike = {
  length: number
  [index: number]: SpeechRecognitionResultLike | undefined
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

type SpeechRecognitionErrorEventLike = {
  error: string
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

export type SpeechRecognitionCardHandle = {
  stopAndKeepTranscript: () => void
}

export type SpeechRecognitionCardProps = {
  locale: string
  transcript: string
  onTranscriptChange: (transcript: string) => void
  className?: string
}

function getSpeechRecognitionConstructor() {
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function shouldHideForError(error: string) {
  return [
    "audio-capture",
    "language-not-supported",
    "network",
    "not-allowed",
    "service-not-allowed",
  ].includes(error)
}

export const SpeechRecognitionCard = forwardRef<
  SpeechRecognitionCardHandle,
  SpeechRecognitionCardProps
>(({ locale, transcript, onTranscriptChange, className }, ref) => {
  const [state, setState] = useState<SpeechRecognitionState>(() =>
    typeof window === "undefined" || !getSpeechRecognitionConstructor() ? "unsupported" : "idle"
  )
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalTranscriptRef = useRef("")

  const cleanupRecognition = useCallback((abort: boolean) => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognition.onstart = null
    recognition.onend = null
    recognition.onresult = null
    recognition.onerror = null
    try {
      if (abort) recognition.abort()
      else recognition.stop()
    } catch {
      // Browser implementations throw when recognition has already stopped.
    }
    recognitionRef.current = null
  }, [])

  const stopAndKeepTranscript = useCallback(() => {
    cleanupRecognition(false)
    setState((current) => (current === "unsupported" ? current : "stopped"))
  }, [cleanupRecognition])

  useImperativeHandle(ref, () => ({ stopAndKeepTranscript }), [stopAndKeepTranscript])

  useEffect(() => {
    return () => cleanupRecognition(true)
  }, [cleanupRecognition])

  useEffect(() => {
    cleanupRecognition(true)
    finalTranscriptRef.current = ""
    setState(
      typeof window !== "undefined" && getSpeechRecognitionConstructor() ? "idle" : "unsupported"
    )
  }, [cleanupRecognition, locale])

  const startRecognition = useCallback(async () => {
    cleanupRecognition(true)
    finalTranscriptRef.current = ""
    onTranscriptChange("")

    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      setState("unsupported")
      return
    }

    if (Recognition.available) {
      try {
        const availability = await Recognition.available({ langs: [locale], processLocally: false })
        if (availability !== "available") {
          setState("unsupported")
          return
        }
      } catch {
        setState("unsupported")
        return
      }
    }

    const recognition = new Recognition()
    recognition.lang = locale
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setState("recording")
    recognition.onend = () => {
      recognitionRef.current = null
      setState((current) => (current === "unsupported" ? current : "stopped"))
    }
    recognition.onerror = (event) => {
      cleanupRecognition(true)
      setState(shouldHideForError(event.error) ? "unsupported" : "stopped")
    }
    recognition.onresult = (event) => {
      let finalTranscript = finalTranscriptRef.current
      const interimParts: string[] = []

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result) continue
        const alternative = result?.[0]
        const part = alternative?.transcript.trim()
        if (!part) continue
        if (result.isFinal) {
          finalTranscript = [finalTranscript, part].filter(Boolean).join(" ")
        } else {
          interimParts.push(part)
        }
      }

      finalTranscriptRef.current = finalTranscript
      onTranscriptChange([finalTranscript, ...interimParts].filter(Boolean).join(" ").trim())
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      cleanupRecognition(true)
      setState("unsupported")
    }
  }, [cleanupRecognition, locale, onTranscriptChange])

  if (state === "unsupported") return null

  const isRecording = state === "recording"
  const hasTranscript = transcript.trim().length > 0
  const Icon = isRecording ? CircleStop : state === "stopped" ? RotateCcw : Mic
  const label = isRecording
    ? "Stop speech recognition"
    : state === "stopped"
      ? "Restart speech recognition"
      : "Start speech recognition"
  const activateRecognition = isRecording ? stopAndKeepTranscript : startRecognition

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={label}
      className={cn(
        "animate-card-in cursor-pointer transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-[hsl(var(--accent-strong))]",
        isRecording && "border-primary/50 bg-primary/5 hover:bg-primary/10",
        className
      )}
      data-testid="speech-recognition-card"
      onClick={activateRecognition}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        activateRecognition()
      }}
    >
      <CardContent className="relative min-h-[4rem] p-4 pr-16">
        <p
          className={cn(
            "min-h-[1.5rem] whitespace-pre-wrap break-words text-lg leading-6",
            !hasTranscript && "text-muted-foreground"
          )}
          data-testid="speech-recognition-transcript"
          aria-live="polite"
        >
          {hasTranscript ? transcript : " "}
        </p>
        <Button
          type="button"
          size="icon"
          variant={isRecording ? "default" : "outline"}
          className="absolute bottom-3 right-3 h-10 w-10 rounded-full"
          aria-hidden="true"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation()
            activateRecognition()
          }}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
})
SpeechRecognitionCard.displayName = "SpeechRecognitionCard"
