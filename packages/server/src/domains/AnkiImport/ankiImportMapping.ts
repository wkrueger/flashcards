import type { AnkiCardMapping, ImportPlugin } from "@cards/shared"
import { hashFront } from "../Cards/cardsService.js"
import { subjectKeyFor } from "../Subjects/subjectsService.js"
import {
  parseJsonArray,
  stripMediaAndMarkup,
  type AnkiArchiveData,
  type MappedImportRow,
  type StoredCardType,
} from "./ankiImportShared.js"

type HighlightRange = {
  start: number
  end: number
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findWordMatches(content: string, word: string, fromIndex: number): HighlightRange[] {
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(word)})(?=$|[^\\p{L}\\p{N}])`, "giu")
  const ranges: HighlightRange[] = []

  for (const match of content.matchAll(regex)) {
    const boundary = match[1] ?? ""
    const matchedWord = match[2]
    const matchIndex = match.index

    if (matchIndex === undefined || !matchedWord) continue

    const start = matchIndex + boundary.length
    if (start < fromIndex) continue

    ranges.push({
      start,
      end: start + matchedWord.length,
    })
  }

  return ranges
}

function compareRangeSets(a: HighlightRange[], b: HighlightRange[]) {
  const aSpan = a[a.length - 1]!.end - a[0]!.start
  const bSpan = b[b.length - 1]!.end - b[0]!.start

  if (aSpan !== bSpan) {
    return aSpan - bSpan
  }

  return a[0]!.start - b[0]!.start
}

function findSequentialWordRanges(content: string, words: string[]): HighlightRange[] | null {
  function search(wordIndex: number, fromIndex: number): HighlightRange[] | null {
    if (wordIndex >= words.length) return []

    const matches = findWordMatches(content, words[wordIndex]!, fromIndex)
    let best: HighlightRange[] | null = null

    for (const match of matches) {
      const tail = search(wordIndex + 1, match.end)
      if (tail) {
        const candidate = [match, ...tail]
        if (!best || compareRangeSets(candidate, best) < 0) {
          best = candidate
        }
      }
    }

    return best
  }

  return search(0, 0)
}

function applyHighlightRanges(content: string, ranges: HighlightRange[]) {
  let result = content

  for (const range of [...ranges].reverse()) {
    result = `${result.slice(0, range.start)}**${result.slice(range.start, range.end)}**${result.slice(range.end)}`
  }

  return result
}

function applyHighlightWords(
  content: string,
  wordsField: string,
  rowValues: Record<string, string>
): string {
  const raw = (rowValues[wordsField] ?? "").trim()
  if (!raw) return content

  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  for (const item of items) {
    const words = item.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue

    const ranges = findSequentialWordRanges(content, words)
    if (ranges) {
      return applyHighlightRanges(content, ranges)
    }
  }

  return `${content}\n\n(**${raw}**)`
}

export function applyPluginsToContent(
  content: string,
  side: "front" | "back",
  plugins: ImportPlugin[],
  rowValues: Record<string, string>
): string {
  let result = content
  for (const plugin of plugins) {
    if (plugin.type === "highlight_words") {
      const field = side === "front" ? plugin.frontWordsField : plugin.backWordsField
      result = applyHighlightWords(result, field, rowValues)
    }
  }
  return result
}

export function collectMappedRows(input: {
  archiveData: AnkiArchiveData
  cardTypes: StoredCardType[]
}) {
  const rows: MappedImportRow[] = []
  const sampleErrors: string[] = []
  let failedRowCount = 0
  const seen = new Set<string>()

  const pushError = (message: string) => {
    failedRowCount += 1
    if (sampleErrors.length < 20) {
      sampleErrors.push(message)
    }
  }

  for (const cardType of input.cardTypes) {
    const subjectField = cardType.subjectField
    const cardMappings = parseJsonArray<AnkiCardMapping>(cardType.cardMappingsJson)
    const plugins = parseJsonArray<ImportPlugin>(cardType.pluginsJson)
    if (!subjectField || cardMappings.length === 0) {
      pushError(`No card mappings configured for ${cardType.modelName}.`)
      continue
    }

    const archiveRows = input.archiveData.rowsByModelKey.get(cardType.modelKey) ?? []

    archiveRows.forEach((row, rowIndex) => {
      cardMappings.forEach((cm, cmIndex) => {
        const subjectText = stripMediaAndMarkup(row.values[subjectField] ?? "")
        const rawFront = stripMediaAndMarkup(row.values[cm.frontField] ?? "")
        const rawBack = stripMediaAndMarkup(row.values[cm.backField] ?? "")

        if (!subjectText || !rawFront || !rawBack) {
          return
        }

        const front = applyPluginsToContent(rawFront, "front", plugins, row.values)
        const back = applyPluginsToContent(rawBack, "back", plugins, row.values)

        const subjectKey = subjectKeyFor(subjectText)
        const frontHash = hashFront(front)
        const duplicateKey = `${subjectKey}\u0000${frontHash}`

        if (seen.has(duplicateKey)) {
          pushError(
            `${cardType.modelName} row ${rowIndex + 1} mapping ${cmIndex + 1} duplicates another mapped card.`
          )
          return
        }

        seen.add(duplicateKey)
        rows.push({ subjectText, subjectKey, front, frontHash, back })
      })
    })
  }

  return {
    rows,
    failedRowCount,
    sampleErrors,
  }
}
