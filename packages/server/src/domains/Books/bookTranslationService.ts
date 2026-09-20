import {
  BookTranslationStatus,
  type PrismaClient,
  type WorkerJob,
} from "../../generated/prisma/client.js"
import { defaultTargetLanguage, getTranslator } from "../../infra/translator.js"
import { BOOK_TRANSLATION_BATCH_CHARS, BOOK_TRANSLATION_JOB_PAGE_LIMIT } from "./bookShared.js"
import { parseTranslationPayload } from "./booksService.js"

type ClaimedPage = { id: string; index: number; markdown: string }

// Drains the pending pages inside the window the reader asked for. Failures are
// recorded per batch rather than thrown, so one bad provider call never stalls
// the whole book — the reader can retry that page from the UI.
export async function runTranslateBookPagesJob(prisma: PrismaClient, job: WorkerJob) {
  if (!job.bookId) throw new Error("Translation job is missing its book id.")

  const book = await prisma.book.findUnique({
    where: { id: job.bookId },
    include: { sourceLanguage: true, targetLanguage: true },
  })
  if (!book) return

  const payload = parseTranslationPayload(job.payloadJson)
  const pages = await claimPages(prisma, {
    bookId: book.id,
    fromIndex: payload?.fromIndex ?? 0,
    toIndex: payload?.toIndex ?? book.pageCount,
  })
  if (pages.length === 0) return

  const translator = getTranslator()
  const sourceLanguage =
    book.sourceLanguage?.englishName ?? book.sourceLanguage?.name ?? book.epubLanguage
  const targetLanguage =
    book.targetLanguage?.englishName ?? book.targetLanguage?.name ?? defaultTargetLanguage()

  for (const batch of batchByChars(pages)) {
    try {
      const translations = await translator.translate({
        sourceLanguage,
        targetLanguage,
        segments: batch.map((page) => ({ id: page.id, markdown: page.markdown })),
      })
      await persistBatch(prisma, batch, translations)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.bookPage.updateMany({
        where: { id: { in: batch.map((page) => page.id) } },
        data: {
          translationStatus: BookTranslationStatus.FAILED,
          translationError: message.slice(0, 300),
        },
      })
    }
  }
}

async function claimPages(
  prisma: PrismaClient,
  input: { bookId: string; fromIndex: number; toIndex: number }
): Promise<ClaimedPage[]> {
  const pages = await prisma.bookPage.findMany({
    where: {
      bookId: input.bookId,
      index: { gte: input.fromIndex, lte: input.toIndex },
      translationStatus: BookTranslationStatus.PENDING,
    },
    orderBy: { index: "asc" },
    take: BOOK_TRANSLATION_JOB_PAGE_LIMIT,
    select: { id: true, index: true, markdown: true },
  })
  if (pages.length === 0) return []

  await prisma.bookPage.updateMany({
    where: { id: { in: pages.map((page) => page.id) } },
    data: { translationStatus: BookTranslationStatus.TRANSLATING, translationError: null },
  })
  return pages
}

async function persistBatch(
  prisma: PrismaClient,
  batch: ClaimedPage[],
  translations: Map<string, string>
) {
  for (const page of batch) {
    const translation = translations.get(page.id)
    if (translation) {
      await prisma.bookPage.update({
        where: { id: page.id },
        data: {
          translation,
          translationStatus: BookTranslationStatus.DONE,
          translationError: null,
        },
      })
    } else {
      await prisma.bookPage.update({
        where: { id: page.id },
        data: {
          translationStatus: BookTranslationStatus.FAILED,
          translationError: "The translation provider skipped this page.",
        },
      })
    }
  }
}

function batchByChars(pages: ClaimedPage[]) {
  const batches: ClaimedPage[][] = []
  let current: ClaimedPage[] = []
  let chars = 0
  for (const page of pages) {
    if (current.length > 0 && chars + page.markdown.length > BOOK_TRANSLATION_BATCH_CHARS) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(page)
    chars += page.markdown.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}
