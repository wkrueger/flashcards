import { createOpenAIStructuredResponse } from "./openai.js"

export interface TranslationSegment {
  id: string
  markdown: string
}

export interface TranslationRequest {
  sourceLanguage: string | null
  targetLanguage: string
  segments: TranslationSegment[]
}

export interface Translator {
  readonly name: string
  /** Resolves to a map of segment id → translated markdown. */
  translate(request: TranslationRequest): Promise<Map<string, string>>
}

export const DEFAULT_TARGET_LANGUAGE = "Portuguese"

export function defaultTargetLanguage() {
  return process.env.BOOK_DEFAULT_TARGET_LANGUAGE?.trim() || DEFAULT_TARGET_LANGUAGE
}

// Provider is chosen by TRANSLATION_PROVIDER. `openai` is the default because it
// is the only one that reliably keeps the simplified markdown intact and it
// reuses the key the card generator already needs. `stub` is for tests and e2e.
export function getTranslator(): Translator {
  const provider = (process.env.TRANSLATION_PROVIDER ?? "openai").trim().toLowerCase()
  if (provider === "stub") return stubTranslator
  if (provider === "deepl") return deeplTranslator
  return openAITranslator
}

const SYSTEM_PROMPT = [
  "You are a literary translator working on a book that is being read one short page at a time.",
  "Translate each segment into the requested target language.",
  "Preserve the markdown exactly: heading levels, bold, italics, blockquotes, list markers and blank lines between paragraphs.",
  "Translate prose only — never add commentary, notes, or a segment that was not asked for.",
  "Keep the translation natural and readable rather than word-for-word.",
  "Return every segment id you were given, exactly once.",
].join(" ")

const openAITranslator: Translator = {
  name: "openai",
  async translate(request) {
    const response = await createOpenAIStructuredResponse({
      systemPrompt: SYSTEM_PROMPT,
      input: JSON.stringify({
        sourceLanguage: request.sourceLanguage ?? "auto-detect",
        targetLanguage: request.targetLanguage,
        segments: request.segments.map((segment) => ({ id: segment.id, text: segment.markdown })),
      }),
      schemaName: "book_page_translations",
      schema: {
        type: "object",
        properties: {
          segments: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, text: { type: "string" } },
              required: ["id", "text"],
            },
          },
        },
        required: ["segments"],
      },
    })

    const translations = new Map<string, string>()
    const segments = (response as { segments?: unknown })?.segments
    if (!Array.isArray(segments)) return translations
    for (const segment of segments) {
      if (!segment || typeof segment !== "object") continue
      const { id, text } = segment as { id?: unknown; text?: unknown }
      if (typeof id === "string" && typeof text === "string" && text.trim()) {
        translations.set(id, text)
      }
    }
    return translations
  },
}

// Opt-in alternative. DeepL has excellent prose quality and a free tier, but it
// does not understand markdown, so `preserve_formatting` is the best we can do
// and emphasis markers may shift.
const deeplTranslator: Translator = {
  name: "deepl",
  async translate(request) {
    const apiKey = process.env.DEEPL_API_KEY
    if (!apiKey) throw new Error("DEEPL_API_KEY is not configured.")

    const endpoint = apiKey.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate"

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: request.segments.map((segment) => segment.markdown),
        target_lang: deeplLanguageCode(request.targetLanguage),
        preserve_formatting: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`DeepL request failed with status ${response.status}.`)
    }

    const body = (await response.json()) as { translations?: { text?: string }[] }
    const translations = new Map<string, string>()
    request.segments.forEach((segment, i) => {
      const text = body.translations?.[i]?.text
      if (typeof text === "string" && text.trim()) translations.set(segment.id, text)
    })
    return translations
  },
}

const stubTranslator: Translator = {
  name: "stub",
  async translate(request) {
    return new Map(
      request.segments.map((segment) => [
        segment.id,
        `${segment.markdown}\n\n_(${request.targetLanguage})_`,
      ])
    )
  },
}

const DEEPL_CODES: Record<string, string> = {
  portuguese: "PT-BR",
  "portuguese (brazil)": "PT-BR",
  "portuguese (portugal)": "PT-PT",
  english: "EN-US",
  german: "DE",
  spanish: "ES",
  french: "FR",
  italian: "IT",
  dutch: "NL",
  japanese: "JA",
}

function deeplLanguageCode(language: string) {
  return DEEPL_CODES[language.trim().toLowerCase()] ?? language.trim().toUpperCase()
}
