import { rm } from "node:fs/promises"

export const BOOK_UPLOAD_DIR = ".uploads/books"
export const BOOK_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

// Pages are chunked at import so page turns never wait on parsing. The target is
// what fits the reader's two cards (original + translation) on a phone screen:
// measured at 20px serif in the ~332px column of a 390pt phone, 280 chars is
// about eight lines per card, which fills the screen between the header and the
// bottom bar. Chunks only ever end on a paragraph or sentence boundary, so the
// number is approximate — a single sentence longer than the max is the only
// thing that gets broken mid-sentence.
export const BOOK_PAGE_TARGET_CHARS = 280
export const BOOK_PAGE_MAX_CHARS = 440

// How many pages ahead of the reader we keep translated.
export const BOOK_TRANSLATION_LOOKAHEAD = 5
// Pages a single TRANSLATE_BOOK_PAGES job drains before finishing.
export const BOOK_TRANSLATION_JOB_PAGE_LIMIT = 12
// Characters bundled into one translation provider request.
export const BOOK_TRANSLATION_BATCH_CHARS = 4000

export class BookError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BAD_REQUEST" | "UNSUPPORTED",
    message: string
  ) {
    super(message)
    this.name = "BookError"
  }
}

export async function deleteFileIfExists(storagePath: string | null | undefined) {
  if (!storagePath) return
  await rm(storagePath, { force: true })
}

export interface TranslationJobPayload {
  fromIndex: number
  toIndex: number
}
