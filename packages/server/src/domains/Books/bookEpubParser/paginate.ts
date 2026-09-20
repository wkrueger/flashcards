import { BOOK_PAGE_MAX_CHARS, BOOK_PAGE_TARGET_CHARS } from "../bookShared.js"

// Turns a chapter's markdown into reader-sized pages. Pages only ever break
// between paragraphs, or — for a paragraph that is too long on its own —
// between sentences, so a page never ends mid-sentence.
export function paginateMarkdown(markdown: string): string[] {
  const blocks = splitBlocks(markdown).flatMap(splitOversizedBlock)
  const pages: string[] = []
  let current: string[] = []
  let length = 0

  for (const block of blocks) {
    const projected = current.length === 0 ? block.length : length + 2 + block.length
    if (current.length > 0 && projected > BOOK_PAGE_TARGET_CHARS) {
      // A heading that landed at the bottom of a full page belongs to the text
      // that follows it, so carry it over instead of orphaning it.
      const carried =
        current.length > 1 && isHeading(current[current.length - 1]!) ? current.pop() : undefined
      pages.push(current.join("\n\n"))
      current = carried ? [carried] : []
      length = carried ? carried.length : 0
    }
    current.push(block)
    length = length === 0 ? block.length : length + 2 + block.length
  }

  if (current.length > 0) pages.push(current.join("\n\n"))
  return pages
}

function splitBlocks(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

function splitOversizedBlock(block: string): string[] {
  if (block.length <= BOOK_PAGE_MAX_CHARS) return [block]

  const chunks: string[] = []
  let current = ""
  for (const sentence of splitSentences(block)) {
    if (current.length > 0 && current.length + sentence.length > BOOK_PAGE_TARGET_CHARS) {
      chunks.push(current.trim())
      current = ""
    }
    current += sentence
  }
  if (current.trim().length > 0) chunks.push(current.trim())
  return chunks
}

function splitSentences(text: string) {
  // Keeps the terminator and any trailing quote/bracket with its sentence.
  const matches = text.match(/[^.!?…]*[.!?…]+["'”’»)\]]*\s*|[^.!?…]+$/g)
  return (matches ?? [text]).flatMap(splitOnWhitespaceIfHuge)
}

function splitOnWhitespaceIfHuge(sentence: string): string[] {
  if (sentence.length <= BOOK_PAGE_MAX_CHARS) return [sentence]

  const parts: string[] = []
  let current = ""
  for (const word of sentence.split(/(\s+)/)) {
    if (current.length > 0 && current.length + word.length > BOOK_PAGE_TARGET_CHARS) {
      parts.push(current)
      current = ""
    }
    current += word
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function isHeading(block: string) {
  return /^#{1,6}\s/.test(block)
}
