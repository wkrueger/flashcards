import { readFile } from "node:fs/promises"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"

import {
  BookStatus,
  BookTranslationStatus,
  LibraryItemKind,
  WorkerJobStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../generated/prisma/client.js"
import {
  BOOK_TRANSLATION_LOOKAHEAD,
  BookError,
  deleteFileIfExists,
  type TranslationJobPayload,
} from "./bookShared.js"
import { parseEpub } from "./bookEpubParser/index.js"

dayjs.extend(utc)

export const BOOK_READING_STATS_WINDOW_DAYS = 7

export async function requireBook(prisma: PrismaClient, userId: string, bookId: string) {
  const book = await prisma.book.findFirst({ where: { id: bookId, userId } })
  if (!book) throw new BookError("NOT_FOUND", "Book not found.")
  return book
}

// --- worker: PARSE_EPUB ---

export async function runParseEpubJob(prisma: PrismaClient, bookId: string) {
  const book = await prisma.book.findUnique({ where: { id: bookId } })
  if (!book) throw new Error(`Book ${bookId} no longer exists.`)

  await prisma.book.update({
    where: { id: book.id },
    data: { status: BookStatus.PARSING, errorSummary: null },
  })

  const parsed = parseEpub(await readFile(book.storagePath))

  await prisma.$transaction(async (tx) => {
    await tx.bookPage.deleteMany({ where: { bookId: book.id } })
    await tx.bookChapter.deleteMany({ where: { bookId: book.id } })

    const chapterIdByOrder = new Map<number, string>()
    for (const chapter of parsed.chapters) {
      const created = await tx.bookChapter.create({
        data: {
          bookId: book.id,
          title: chapter.title,
          order: chapter.order,
          startPageIndex: chapter.startPageIndex,
        },
      })
      chapterIdByOrder.set(chapter.order, created.id)
    }

    await tx.bookPage.createMany({
      data: parsed.pages.map((page) => ({
        bookId: book.id,
        index: page.index,
        chapterId:
          page.chapterOrder == null ? null : (chapterIdByOrder.get(page.chapterOrder) ?? null),
        markdown: page.markdown,
        charCount: page.charCount,
      })),
    })

    await tx.book.update({
      where: { id: book.id },
      data: {
        title: parsed.title || book.title,
        author: parsed.author,
        epubLanguage: parsed.language,
        pageCount: parsed.pages.length,
        status: BookStatus.READY,
        errorSummary: null,
      },
    })
    // The library row shows the real title once it is known.
    await tx.deck.update({
      where: { id: book.deckId },
      data: { name: await availableName(tx, book.userId, parsed.title || book.title, book.deckId) },
    })
  })
}

export async function handleBookWorkerJobError(
  prisma: PrismaClient,
  bookId: string | null,
  type: WorkerJobType,
  message: string
) {
  if (!bookId) return

  if (type === WorkerJobType.PARSE_EPUB) {
    await prisma.book.updateMany({
      where: { id: bookId },
      data: { status: BookStatus.FAILED, errorSummary: message.slice(0, 500) },
    })
    return
  }

  // A crashed translation job would otherwise leave its claimed pages stuck in
  // TRANSLATING; hand them back so the next lookahead can retry them.
  await prisma.bookPage.updateMany({
    where: { bookId, translationStatus: BookTranslationStatus.TRANSLATING },
    data: { translationStatus: BookTranslationStatus.PENDING },
  })
}

// --- reading progress ---

export async function recordReadingProgress(
  prisma: PrismaClient,
  input: { userId: string; bookId: string; pageIndex: number }
) {
  const book = await requireBook(prisma, input.userId, input.bookId)
  if (book.pageCount === 0) return { currentPageIndex: 0, furthestPageIndex: 0 }

  const pageIndex = clamp(input.pageIndex, 0, book.pageCount - 1)
  const furthest = Math.max(book.furthestPageIndex, pageIndex)
  // Only newly reached pages count towards the daily chart, so re-reading a
  // chapter doesn't inflate it.
  const pagesRead = Math.max(0, furthest - book.furthestPageIndex)

  await prisma.book.update({
    where: { id: book.id },
    data: { currentPageIndex: pageIndex, furthestPageIndex: furthest, lastReadAt: new Date() },
  })

  if (pagesRead > 0) {
    const date = dayjs.utc().startOf("day").toDate()
    await prisma.bookReadingStat.upsert({
      where: { bookId_date: { bookId: book.id, date } },
      create: { bookId: book.id, date, pagesRead },
      update: { pagesRead: { increment: pagesRead } },
    })
  }

  return { currentPageIndex: pageIndex, furthestPageIndex: furthest }
}

export async function readingStatsForBook(prisma: PrismaClient, bookId: string) {
  const dayMs = 24 * 60 * 60 * 1000
  const today = dayjs.utc().startOf("day").toDate()
  const earliest = new Date(today.getTime() - (BOOK_READING_STATS_WINDOW_DAYS - 1) * dayMs)
  const rows = await prisma.bookReadingStat.findMany({
    where: { bookId, date: { gte: earliest } },
    orderBy: { date: "asc" },
    select: { date: true, pagesRead: true },
  })
  const byTime = new Map(rows.map((row) => [row.date.getTime(), row.pagesRead]))
  return Array.from({ length: BOOK_READING_STATS_WINDOW_DAYS }, (_, i) => {
    const date = new Date(earliest.getTime() + i * dayMs)
    return { date, pagesRead: byTime.get(date.getTime()) ?? 0 }
  })
}

// --- lazy translation scheduling ---

// Called on every page turn. Keeps a few pages ahead of the reader queued for
// translation without ever blocking the page itself.
export async function ensureTranslationLookahead(
  prisma: PrismaClient,
  input: { bookId: string; fromIndex: number }
) {
  const fromIndex = Math.max(0, input.fromIndex)
  const toIndex = fromIndex + BOOK_TRANSLATION_LOOKAHEAD

  const active = await prisma.workerJob.findFirst({
    where: {
      bookId: input.bookId,
      type: WorkerJobType.TRANSLATE_BOOK_PAGES,
      status: { in: [WorkerJobStatus.PENDING, WorkerJobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!active) {
    // Nothing is running, so any page left mid-flight is orphaned.
    await prisma.bookPage.updateMany({
      where: { bookId: input.bookId, translationStatus: BookTranslationStatus.TRANSLATING },
      data: { translationStatus: BookTranslationStatus.PENDING },
    })
  }

  const untranslated = await prisma.bookPage.count({
    where: {
      bookId: input.bookId,
      index: { gte: fromIndex, lte: toIndex },
      translationStatus: { in: [BookTranslationStatus.PENDING, BookTranslationStatus.TRANSLATING] },
    },
  })
  if (untranslated === 0) return { enqueued: false }

  if (active?.status === WorkerJobStatus.PENDING) {
    // Widen the queued job's window instead of piling up jobs per page turn.
    const payload = parseTranslationPayload(active.payloadJson)
    await prisma.workerJob.update({
      where: { id: active.id },
      data: {
        payloadJson: JSON.stringify({
          fromIndex: Math.min(payload?.fromIndex ?? fromIndex, fromIndex),
          toIndex: Math.max(payload?.toIndex ?? toIndex, toIndex),
        } satisfies TranslationJobPayload),
      },
    })
    return { enqueued: false }
  }

  if (active?.status === WorkerJobStatus.RUNNING) return { enqueued: false }

  await prisma.workerJob.create({
    data: {
      type: WorkerJobType.TRANSLATE_BOOK_PAGES,
      bookId: input.bookId,
      payloadJson: JSON.stringify({ fromIndex, toIndex } satisfies TranslationJobPayload),
    },
  })
  return { enqueued: true }
}

export function parseTranslationPayload(payloadJson: string | null): TranslationJobPayload | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as Partial<TranslationJobPayload>
    if (typeof parsed.fromIndex !== "number" || typeof parsed.toIndex !== "number") return null
    return { fromIndex: parsed.fromIndex, toIndex: parsed.toIndex }
  } catch {
    return null
  }
}

// --- deletion ---

export async function deleteBook(prisma: PrismaClient, userId: string, bookId: string) {
  const book = await requireBook(prisma, userId, bookId)
  // The Deck row is the library entry; deleting it cascades to the Book.
  await prisma.deck.deleteMany({ where: { id: book.deckId, userId, kind: LibraryItemKind.BOOK } })
  await deleteFileIfExists(book.storagePath)
  return { ok: true }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type DeckNameClient = Pick<PrismaClient, "deck">

async function availableName(
  tx: DeckNameClient,
  userId: string,
  base: string,
  ignoreDeckId: string
) {
  const trimmed = base.trim().slice(0, 100) || "Book"
  for (let attempt = 1; attempt <= 50; attempt++) {
    const name = attempt === 1 ? trimmed : `${trimmed.slice(0, 92)} (${attempt})`
    const taken = await tx.deck.findFirst({
      where: { userId, name, NOT: { id: ignoreDeckId } },
      select: { id: true },
    })
    if (!taken) return name
  }
  return `${trimmed.slice(0, 80)} ${Date.now()}`
}
