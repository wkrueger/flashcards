import { Readable } from "node:stream"
import { beforeEach, describe, expect, it } from "vitest"
import {
  BookStatus,
  BookTranslationStatus,
  LibraryItemKind,
  WorkerJobStatus,
  WorkerJobType,
} from "../../src/generated/prisma/client.js"
import { prisma } from "../../src/infra/db.js"
import { runNextWorkerJob } from "../../src/infra/worker.js"
import { parseEpub } from "../../src/domains/Books/bookEpubParser/index.js"
import { paginateMarkdown } from "../../src/domains/Books/bookEpubParser/paginate.js"
import { handleBookUpload } from "../../src/domains/Books/bookUpload.js"
import { BOOK_PAGE_MAX_CHARS } from "../../src/domains/Books/bookShared.js"
import { buildEpubFixture, loremParagraph } from "../epubFixture.js"
import { callerFor, makeUser, resetDomain } from "../helpers.js"

process.env.TRANSLATION_PROVIDER = "stub"

const fixture = () =>
  buildEpubFixture({
    title: "The Test Book",
    author: "A. Writer",
    language: "de",
    chapters: [
      {
        title: "Chapter One",
        paragraphs: [loremParagraph("alpha"), loremParagraph("beta"), loremParagraph("gamma")],
      },
      { title: "Chapter Two", paragraphs: [loremParagraph("delta")] },
    ],
  })

async function uploadFixture(userId: string, filename = "the-test-book.epub") {
  const buffer = fixture()
  const stream = Readable.from(buffer) as NodeJS.ReadableStream & { truncated?: boolean }
  return handleBookUpload(prisma, {
    userId,
    part: { filename, mimetype: "application/epub+zip", file: stream },
  })
}

/** Runs queued worker jobs until the queue is empty (bounded, so a bug can't hang the suite). */
async function drainWorker(maxJobs = 20) {
  for (let i = 0; i < maxJobs; i++) {
    if (!(await runNextWorkerJob(prisma))) return
  }
  throw new Error("Worker queue did not drain.")
}

async function readyBook(userId: string) {
  const { bookId } = await uploadFixture(userId)
  await drainWorker()
  return bookId
}

describe("epub parsing", () => {
  it("reads metadata, chapters and pages out of an epub", () => {
    const book = parseEpub(fixture())

    expect(book.title).toBe("The Test Book")
    expect(book.author).toBe("A. Writer")
    expect(book.language).toBe("de")
    expect(book.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"])
    expect(book.chapters[0]!.startPageIndex).toBe(0)
    expect(book.pages.length).toBeGreaterThan(1)
    expect(book.pages[0]!.markdown).toContain("# Chapter One")
    // Every page belongs to the chapter that was open when it was produced.
    expect(book.pages.at(-1)!.chapterOrder).toBe(1)
  })

  it("rejects a file that is not an epub", () => {
    expect(() => parseEpub(Buffer.from("not a zip"))).toThrow(/EPUB/i)
  })

  it("never ends a page mid-sentence", () => {
    const paragraph = Array.from(
      { length: 40 },
      (_, i) => `Sentence ${i + 1} is long enough to force the paginator to split this paragraph.`
    ).join(" ")

    const pages = paginateMarkdown(paragraph)

    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(BOOK_PAGE_MAX_CHARS)
      expect(page.trimEnd().endsWith(".")).toBe(true)
    }
  })

  it("keeps a heading with the text that follows it", () => {
    const pages = paginateMarkdown(
      [loremParagraph("one"), loremParagraph("two"), "## A Heading", loremParagraph("three")].join(
        "\n\n"
      )
    )

    const headingPage = pages.findIndex((page) => page.includes("## A Heading"))
    expect(headingPage).toBeGreaterThanOrEqual(0)
    expect(pages[headingPage]!.trim()).not.toBe("## A Heading")
  })
})

describe("book upload and parse job", () => {
  let userId: string

  beforeEach(async () => {
    await resetDomain()
    userId = await makeUser("reader")
  })

  it("creates a library item and turns it into a readable book", async () => {
    const { bookId, deckId } = await uploadFixture(userId)

    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    expect(deck.kind).toBe(LibraryItemKind.BOOK)

    await drainWorker()

    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } })
    expect(book.status).toBe(BookStatus.READY)
    expect(book.title).toBe("The Test Book")
    expect(book.pageCount).toBeGreaterThan(1)

    // The library row takes the real title from the file.
    const renamed = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    expect(renamed.name).toBe("The Test Book")
  })

  it("rejects a non-epub upload", async () => {
    const stream = Readable.from(Buffer.from("x")) as NodeJS.ReadableStream
    await expect(
      handleBookUpload(prisma, {
        userId,
        part: { filename: "notes.txt", mimetype: "text/plain", file: stream },
      })
    ).rejects.toThrow(/\.epub/)
  })

  it("marks the book FAILED when the file cannot be parsed", async () => {
    const stream = Readable.from(Buffer.from("definitely not a zip")) as NodeJS.ReadableStream
    const { bookId } = await handleBookUpload(prisma, {
      userId,
      part: { filename: "broken.epub", mimetype: "application/epub+zip", file: stream },
    })

    await drainWorker()

    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } })
    expect(book.status).toBe(BookStatus.FAILED)
    expect(book.errorSummary).toBeTruthy()
  })

  it("gives a second upload of the same title a distinct library name", async () => {
    const first = await uploadFixture(userId)
    await drainWorker()
    const second = await uploadFixture(userId)
    await drainWorker()

    const names = await prisma.deck.findMany({
      where: { id: { in: [first.deckId, second.deckId] } },
      select: { name: true },
    })
    expect(new Set(names.map((n) => n.name)).size).toBe(2)
  })
})

describe("book reading", () => {
  let userId: string
  let bookId: string

  beforeEach(async () => {
    await resetDomain()
    userId = await makeUser("reader")
    bookId = await readyBook(userId)
  })

  it("lists the book on the home list with its kind and progress", async () => {
    const caller = callerFor(userId)
    await caller.decks.create({ name: "A normal deck" })

    const list = await caller.decks.list({})
    const book = list.items.find((item) => item.kind === "BOOK")
    const deck = list.items.find((item) => item.kind === "DECK")

    expect(deck?.book).toBeNull()
    expect(book?.book?.id).toBe(bookId)
    expect(book?.book?.status).toBe(BookStatus.READY)
    expect(book?.book?.progressPercent).toBeGreaterThan(0)
  })

  it("serves chapters and pages", async () => {
    const caller = callerFor(userId)

    const chapters = await caller.books.chapters({ bookId })
    expect(chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"])

    const page = await caller.books.readPage({ bookId, index: 0 })
    expect(page.markdown).toContain("Chapter One")
    expect(page.chapterTitle).toBe("Chapter One")
    expect(page.translation).toBeNull()
  })

  it("records progress and daily pages read, and never counts a re-read twice", async () => {
    const caller = callerFor(userId)

    await caller.books.setProgress({ bookId, pageIndex: 2 })
    await caller.books.setProgress({ bookId, pageIndex: 1 })

    const book = await caller.books.get({ bookId })
    expect(book.currentPageIndex).toBe(1)
    expect(book.furthestPageIndex).toBe(2)

    const stats = await caller.books.readingStats({ bookId })
    expect(stats).toHaveLength(7)
    expect(stats.at(-1)!.pagesRead).toBe(2)
  })

  it("clamps progress to the last page", async () => {
    const caller = callerFor(userId)
    const book = await caller.books.get({ bookId })

    await caller.books.setProgress({ bookId, pageIndex: book.pageCount + 100 })

    expect((await caller.books.get({ bookId })).currentPageIndex).toBe(book.pageCount - 1)
  })

  it("manages named bookmarks", async () => {
    const caller = callerFor(userId)

    const created = await caller.books.createBookmark({ bookId, pageIndex: 1, name: "A good bit" })
    expect((await caller.books.bookmarks({ bookId })).map((b) => b.name)).toEqual(["A good bit"])

    await caller.books.renameBookmark({ id: created.id, name: "A better bit" })
    expect((await caller.books.bookmarks({ bookId }))[0]!.name).toBe("A better bit")

    await caller.books.deleteBookmark({ id: created.id })
    expect(await caller.books.bookmarks({ bookId })).toHaveLength(0)
  })

  it("refuses a bookmark outside the book", async () => {
    const caller = callerFor(userId)
    const book = await caller.books.get({ bookId })

    await expect(
      caller.books.createBookmark({ bookId, pageIndex: book.pageCount, name: "nope" })
    ).rejects.toThrow()
  })
})

describe("lazy translation", () => {
  let userId: string
  let bookId: string

  beforeEach(async () => {
    await resetDomain()
    userId = await makeUser("reader")
    bookId = await readyBook(userId)
  })

  it("queues one job per book and widens it instead of piling up", async () => {
    const caller = callerFor(userId)

    expect(await caller.books.prefetchTranslations({ bookId, fromIndex: 0 })).toEqual({
      enqueued: true,
    })
    expect(await caller.books.prefetchTranslations({ bookId, fromIndex: 1 })).toEqual({
      enqueued: false,
    })

    const jobs = await prisma.workerJob.findMany({
      where: { bookId, type: WorkerJobType.TRANSLATE_BOOK_PAGES },
    })
    expect(jobs).toHaveLength(1)
    expect(JSON.parse(jobs[0]!.payloadJson!)).toEqual({ fromIndex: 0, toIndex: 6 })
  })

  it("translates the requested window and leaves the rest alone", async () => {
    const caller = callerFor(userId)
    await caller.books.prefetchTranslations({ bookId, fromIndex: 0 })
    await drainWorker()

    const page = await caller.books.readPage({ bookId, index: 0 })
    expect(page.translationStatus).toBe(BookTranslationStatus.DONE)
    expect(page.translation).toContain(page.markdown)

    const job = await prisma.workerJob.findFirstOrThrow({
      where: { bookId, type: WorkerJobType.TRANSLATE_BOOK_PAGES },
    })
    expect(job.status).toBe(WorkerJobStatus.SUCCEEDED)
  })

  it("does not queue anything when the window is already translated", async () => {
    const caller = callerFor(userId)
    await caller.books.prefetchTranslations({ bookId, fromIndex: 0 })
    await drainWorker()

    expect(await caller.books.prefetchTranslations({ bookId, fromIndex: 0 })).toEqual({
      enqueued: false,
    })
  })

  it("hands pages back to PENDING when a translation job dies mid-flight", async () => {
    await prisma.bookPage.updateMany({
      where: { bookId, index: 0 },
      data: { translationStatus: BookTranslationStatus.TRANSLATING },
    })

    await callerFor(userId).books.prefetchTranslations({ bookId, fromIndex: 0 })

    const page = await prisma.bookPage.findFirstOrThrow({ where: { bookId, index: 0 } })
    expect(page.translationStatus).toBe(BookTranslationStatus.PENDING)
  })

  it("retries a failed page on request", async () => {
    const caller = callerFor(userId)
    await prisma.bookPage.updateMany({
      where: { bookId, index: 0 },
      data: { translationStatus: BookTranslationStatus.FAILED, translationError: "boom" },
    })

    await caller.books.retryTranslation({ bookId, index: 0 })
    await drainWorker()

    const page = await caller.books.readPage({ bookId, index: 0 })
    expect(page.translationStatus).toBe(BookTranslationStatus.DONE)
    expect(page.translationError).toBeNull()
  })

  it("drops existing translations when the target language changes", async () => {
    const caller = callerFor(userId)
    await caller.books.prefetchTranslations({ bookId, fromIndex: 0 })
    await drainWorker()

    const language = await prisma.language.create({
      data: { name: `Klingon-${Date.now()}`, emoji: "🖖" },
    })
    await caller.books.update({ bookId, targetLanguageId: language.id })

    const page = await caller.books.readPage({ bookId, index: 0 })
    expect(page.translation).toBeNull()
    expect(page.translationStatus).toBe(BookTranslationStatus.PENDING)
  })
})

describe("book scoping", () => {
  let userId: string
  let otherUserId: string
  let bookId: string
  let deckId: string

  beforeEach(async () => {
    await resetDomain()
    userId = await makeUser("owner")
    otherUserId = await makeUser("intruder")
    const uploaded = await uploadFixture(userId)
    bookId = uploaded.bookId
    deckId = uploaded.deckId
    await drainWorker()
  })

  it("hides another user's book", async () => {
    const intruder = callerFor(otherUserId)

    await expect(intruder.books.get({ bookId })).rejects.toThrow()
    await expect(intruder.books.readPage({ bookId, index: 0 })).rejects.toThrow()
    await expect(intruder.books.setProgress({ bookId, pageIndex: 1 })).rejects.toThrow()
    await expect(intruder.books.delete({ bookId })).rejects.toThrow()
    expect((await intruder.decks.list({})).items).toHaveLength(0)
  })

  it("keeps books out of the deck-only routes", async () => {
    const caller = callerFor(userId)

    await expect(caller.decks.get({ id: deckId })).rejects.toThrow()
    await expect(caller.decks.update({ id: deckId, name: "hijacked" })).rejects.toThrow()
    await expect(caller.decks.reviewStats({ id: deckId })).rejects.toThrow()
    await expect(caller.decks.upcomingDueCounts({ id: deckId })).rejects.toThrow()
    await expect(caller.decks.delete({ id: deckId })).rejects.toThrow()
    await expect(
      caller.cards.create({ deckId, subjectText: "x", front: "y", back: "z" })
    ).rejects.toThrow()
    await expect(caller.offline.snapshot({ deckId })).rejects.toThrow()
  })

  it("still lets a book be reordered on the home list", async () => {
    const caller = callerFor(userId)
    const deck = await caller.decks.create({ name: "A normal deck" })

    await caller.decks.move({ id: deckId, afterId: deck.id })

    const list = await caller.decks.list({})
    expect(list.items.map((item) => item.kind)).toEqual(["DECK", "BOOK"])
  })

  it("deletes the book and its library row together", async () => {
    await callerFor(userId).books.delete({ bookId })

    expect(await prisma.deck.findUnique({ where: { id: deckId } })).toBeNull()
    expect(await prisma.bookPage.count({ where: { bookId } })).toBe(0)
  })
})
