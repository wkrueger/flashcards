import { TRPCError } from "@trpc/server"
import {
  bookIdInput,
  bookPageInput,
  bookPrefetchInput,
  bookProgressInput,
  createBookBookmarkInput,
  renameBookBookmarkInput,
  updateBookInput,
} from "@cards/shared"

import { protectedProcedure, router } from "../../infra/trpc.js"
import { BookTranslationStatus, LibraryItemKind } from "../../generated/prisma/client.js"
import { BookError } from "./bookShared.js"
import {
  deleteBook,
  ensureTranslationLookahead,
  readingStatsForBook,
  recordReadingProgress,
  requireBook,
} from "./booksService.js"

export const booksRouter = router({
  get: protectedProcedure.input(bookIdInput).query(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    const [chapterCount, bookmarkCount] = await Promise.all([
      ctx.prisma.bookChapter.count({ where: { bookId: book.id } }),
      ctx.prisma.bookBookmark.count({ where: { bookId: book.id } }),
    ])
    return {
      id: book.id,
      deckId: book.deckId,
      title: book.title,
      author: book.author,
      epubLanguage: book.epubLanguage,
      sourceLanguageId: book.sourceLanguageId,
      targetLanguageId: book.targetLanguageId,
      status: book.status,
      errorSummary: book.errorSummary,
      pageCount: book.pageCount,
      currentPageIndex: book.currentPageIndex,
      furthestPageIndex: book.furthestPageIndex,
      progressPercent: progressPercent(book.furthestPageIndex, book.pageCount),
      lastReadAt: book.lastReadAt,
      chapterCount,
      bookmarkCount,
      createdAt: book.createdAt,
    }
  }),

  chapters: protectedProcedure.input(bookIdInput).query(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    return ctx.prisma.bookChapter.findMany({
      where: { bookId: book.id },
      orderBy: { order: "asc" },
      select: { id: true, title: true, order: true, startPageIndex: true },
    })
  }),

  readingStats: protectedProcedure.input(bookIdInput).query(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    return readingStatsForBook(ctx.prisma, book.id)
  }),

  // One page of the reader. The translation may still be null — the reader shows
  // the original immediately and fills the translation in when it lands.
  readPage: protectedProcedure.input(bookPageInput).query(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    const page = await ctx.prisma.bookPage.findUnique({
      where: { bookId_index: { bookId: book.id, index: input.index } },
      include: { chapter: { select: { title: true } } },
    })
    if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Page not found." })
    return {
      index: page.index,
      markdown: page.markdown,
      translation: page.translation,
      translationStatus: page.translationStatus,
      translationError: page.translationError,
      chapterTitle: page.chapter?.title ?? null,
      pageCount: book.pageCount,
    }
  }),

  prefetchTranslations: protectedProcedure
    .input(bookPrefetchInput)
    .mutation(async ({ ctx, input }) => {
      const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
      return ensureTranslationLookahead(ctx.prisma, {
        bookId: book.id,
        fromIndex: input.fromIndex,
      })
    }),

  retryTranslation: protectedProcedure.input(bookPageInput).mutation(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    await ctx.prisma.bookPage.updateMany({
      where: {
        bookId: book.id,
        index: input.index,
        translationStatus: BookTranslationStatus.FAILED,
      },
      data: { translationStatus: BookTranslationStatus.PENDING, translationError: null },
    })
    return ensureTranslationLookahead(ctx.prisma, { bookId: book.id, fromIndex: input.index })
  }),

  setProgress: protectedProcedure.input(bookProgressInput).mutation(async ({ ctx, input }) =>
    toTRPC(() =>
      recordReadingProgress(ctx.prisma, {
        userId: ctx.user.id,
        bookId: input.bookId,
        pageIndex: input.pageIndex,
      })
    )
  ),

  bookmarks: protectedProcedure.input(bookIdInput).query(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    return ctx.prisma.bookBookmark.findMany({
      where: { bookId: book.id },
      orderBy: { pageIndex: "asc" },
      select: { id: true, name: true, pageIndex: true, createdAt: true },
    })
  }),

  createBookmark: protectedProcedure
    .input(createBookBookmarkInput)
    .mutation(async ({ ctx, input }) => {
      const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
      if (book.pageCount > 0 && input.pageIndex >= book.pageCount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That page is outside the book." })
      }
      return ctx.prisma.bookBookmark.create({
        data: { bookId: book.id, pageIndex: input.pageIndex, name: input.name },
        select: { id: true, name: true, pageIndex: true, createdAt: true },
      })
    }),

  renameBookmark: protectedProcedure
    .input(renameBookBookmarkInput)
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.bookBookmark.updateMany({
        where: { id: input.id, book: { userId: ctx.user.id } },
        data: { name: input.name },
      })
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" })
      return { ok: true }
    }),

  deleteBookmark: protectedProcedure
    .input(renameBookBookmarkInput.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.prisma.bookBookmark.deleteMany({
        where: { id: input.id, book: { userId: ctx.user.id } },
      })
      if (deleted.count === 0) throw new TRPCError({ code: "NOT_FOUND" })
      return { ok: true }
    }),

  update: protectedProcedure.input(updateBookInput).mutation(async ({ ctx, input }) => {
    const book = await toTRPC(() => requireBook(ctx.prisma, ctx.user.id, input.bookId))
    const languageIds = [input.sourceLanguageId, input.targetLanguageId].filter(
      (value): value is number => typeof value === "number"
    )
    if (languageIds.length > 0) {
      const found = await ctx.prisma.language.count({ where: { id: { in: languageIds } } })
      if (found !== new Set(languageIds).size) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Language not found." })
      }
    }

    if (input.title !== undefined && input.title !== book.title) {
      const conflict = await ctx.prisma.deck.findFirst({
        where: { userId: ctx.user.id, name: input.title, NOT: { id: book.deckId } },
        select: { id: true },
      })
      if (conflict) {
        throw new TRPCError({ code: "CONFLICT", message: "An item with that name already exists." })
      }
    }

    await ctx.prisma.$transaction(async (tx) => {
      await tx.book.update({
        where: { id: book.id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.sourceLanguageId === undefined
            ? {}
            : { sourceLanguageId: input.sourceLanguageId ?? null }),
          ...(input.targetLanguageId === undefined
            ? {}
            : { targetLanguageId: input.targetLanguageId ?? null }),
        },
      })
      if (input.title !== undefined) {
        await tx.deck.update({
          where: { id: book.deckId, kind: LibraryItemKind.BOOK },
          data: { name: input.title },
        })
      }
      // Changing a language invalidates translations that were already made.
      if (
        input.targetLanguageId !== undefined &&
        input.targetLanguageId !== book.targetLanguageId
      ) {
        await tx.bookPage.updateMany({
          where: { bookId: book.id },
          data: {
            translation: null,
            translationStatus: BookTranslationStatus.PENDING,
            translationError: null,
          },
        })
      }
    })

    return { ok: true }
  }),

  delete: protectedProcedure
    .input(bookIdInput)
    .mutation(async ({ ctx, input }) =>
      toTRPC(() => deleteBook(ctx.prisma, ctx.user.id, input.bookId))
    ),
})

export function progressPercent(furthestPageIndex: number, pageCount: number) {
  if (pageCount <= 0) return 0
  return Math.min(100, Math.round(((furthestPageIndex + 1) / pageCount) * 100))
}

async function toTRPC<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof BookError) {
      throw new TRPCError({
        code: error.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
        message: error.message,
      })
    }
    throw error
  }
}
