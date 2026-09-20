import { BookError } from "../bookShared.js"
import { openEpubArchive } from "./epubArchive.js"
import { htmlToMarkdown } from "./htmlToMarkdown.js"
import { paginateMarkdown } from "./paginate.js"

export interface ParsedBookChapter {
  title: string
  order: number
  startPageIndex: number
}

export interface ParsedBookPage {
  index: number
  markdown: string
  charCount: number
  chapterOrder: number | null
}

export interface ParsedBook {
  title: string
  author: string | null
  language: string | null
  chapters: ParsedBookChapter[]
  pages: ParsedBookPage[]
}

export function parseEpub(buffer: Buffer): ParsedBook {
  const archive = openEpubArchive(buffer)
  const titleByPath = firstTitleByPath(archive.toc)

  const chapters: ParsedBookChapter[] = []
  const pages: ParsedBookPage[] = []
  let chapterOrder: number | null = null

  for (const entry of archive.spine) {
    const markdown = readSpineMarkdown(archive.readText, entry.path)
    if (!markdown) continue

    const documentPages = paginateMarkdown(markdown)
    if (documentPages.length === 0) continue

    // Chapters follow the table of contents: a spine document the TOC names
    // starts a chapter, and any document after it without its own TOC entry
    // continues that chapter.
    const chapterTitle = titleByPath.get(entry.path)
    if (chapterTitle) {
      chapterOrder = chapters.length
      chapters.push({ title: chapterTitle, order: chapterOrder, startPageIndex: pages.length })
    }

    for (const markdownPage of documentPages) {
      pages.push({
        index: pages.length,
        markdown: markdownPage,
        charCount: markdownPage.length,
        chapterOrder,
      })
    }
  }

  if (pages.length === 0) {
    throw new BookError("UNSUPPORTED", "No readable text was found in the EPUB.")
  }

  return {
    title: archive.title,
    author: archive.author,
    language: archive.language,
    chapters,
    pages,
  }
}

function firstTitleByPath(toc: { title: string; path: string }[]) {
  const byPath = new Map<string, string>()
  for (const entry of toc) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry.title)
  }
  return byPath
}

function readSpineMarkdown(readText: (path: string) => string, path: string) {
  try {
    return htmlToMarkdown(readText(path))
  } catch (error) {
    // A single unreadable document shouldn't fail the whole import.
    if (error instanceof BookError) return ""
    throw error
  }
}
