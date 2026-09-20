import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { LibraryItemKind, WorkerJobType, type PrismaClient } from "../../generated/prisma/client.js"
import {
  BOOK_UPLOAD_DIR,
  BOOK_UPLOAD_MAX_BYTES,
  BookError,
  deleteFileIfExists,
} from "./bookShared.js"

const ALLOWED_EPUB_MIME_TYPES = new Set([
  "application/epub+zip",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
])

export interface BookUploadPart {
  filename?: string
  mimetype?: string
  file: NodeJS.ReadableStream & { truncated?: boolean }
  // Multipart fields parsed before the file part; carries the optional name.
  fields?: Record<string, unknown>
}

export function isSupportedEpubUpload(filename: string, mimetype: string | undefined) {
  const normalizedMime = (mimetype ?? "").toLowerCase()
  return (
    extname(filename).toLowerCase() === ".epub" &&
    (!normalizedMime || ALLOWED_EPUB_MIME_TYPES.has(normalizedMime))
  )
}

// Creates the library row (a Deck with kind BOOK) plus its Book satellite and
// queues the parse job. Parsing happens in the worker so the upload response is
// immediate and the client can poll the book's status.
export async function handleBookUpload(
  prisma: PrismaClient,
  input: { userId: string; part: BookUploadPart | undefined }
) {
  const part = input.part
  if (!part) throw new BookError("BAD_REQUEST", "No file was uploaded.")
  if (!part.filename || !isSupportedEpubUpload(part.filename, part.mimetype)) {
    part.file.resume?.()
    throw new BookError("BAD_REQUEST", "Only .epub uploads are supported.")
  }

  const filename = basename(part.filename)
  let storagePath: string | null = null

  try {
    const written = await writeUploadToStorage(part.file)
    storagePath = written.storagePath

    if (part.file.truncated || written.fileSize > BOOK_UPLOAD_MAX_BYTES) {
      throw new BookError("BAD_REQUEST", "The uploaded file exceeds the 50MB limit.")
    }

    const givenTitle = uploadedTitle(part)
    const name = await availableDeckName(
      prisma,
      input.userId,
      givenTitle || filenameToTitle(filename)
    )
    const book = await prisma.$transaction(async (tx) => {
      const deck = await tx.deck.create({
        data: { name, userId: input.userId, kind: LibraryItemKind.BOOK },
      })
      const created = await tx.book.create({
        data: {
          deckId: deck.id,
          userId: input.userId,
          title: name,
          titleLocked: Boolean(givenTitle),
          filename,
          fileSize: written.fileSize,
          storagePath: written.storagePath,
        },
      })
      await tx.workerJob.create({
        data: { type: WorkerJobType.PARSE_EPUB, bookId: created.id },
      })
      return created
    })

    return { bookId: book.id, deckId: book.deckId }
  } catch (error) {
    await deleteFileIfExists(storagePath)
    throw error
  }
}

async function writeUploadToStorage(fileStream: NodeJS.ReadableStream) {
  const uploadDir = resolve(process.cwd(), BOOK_UPLOAD_DIR)
  await mkdir(uploadDir, { recursive: true })
  const storagePath = join(uploadDir, `${Date.now()}-${randomUUID()}.epub`)

  let fileSize = 0
  const countBytes = new Transform({
    transform(chunk, _encoding, callback) {
      fileSize += chunk.length
      callback(null, chunk)
    },
  })

  await pipeline(fileStream, countBytes, createWriteStream(storagePath))
  return { fileSize, storagePath }
}

// The client sends the optional name before the file, so @fastify/multipart has
// already parsed it onto the file part by the time we get here.
function uploadedTitle(part: BookUploadPart) {
  const field = part.fields?.name
  const value = (Array.isArray(field) ? field[0] : field) as { value?: unknown } | undefined
  return typeof value?.value === "string" ? value.value.trim().slice(0, 100) : ""
}

function filenameToTitle(filename: string) {
  const base = filename
    .replace(/\.epub$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  return (base || "Book").slice(0, 100)
}

// Deck names are unique per user, so fall back to "Title (2)", "Title (3)", …
export async function availableDeckName(prisma: PrismaClient, userId: string, base: string) {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const name = attempt === 1 ? base : `${base.slice(0, 92)} (${attempt})`
    const taken = await prisma.deck.findFirst({ where: { userId, name }, select: { id: true } })
    if (!taken) return name
  }
  return `${base.slice(0, 80)} ${Date.now()}`
}
