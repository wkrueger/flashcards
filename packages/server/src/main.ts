import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import Fastify from "fastify"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify"
import { auth } from "./infra/auth.js"
import { createContext } from "./infra/trpc.js"
import { appRouter } from "./domains/_app.router.js"
import { prisma } from "./infra/db.js"
import {
  ANKI_IMPORT_UPLOAD_MAX_BYTES,
  handleAnkiImportUpload,
} from "./domains/anki-import/anki-import.service.js"
import { SpreadsheetImportStatus } from "./generated/prisma/client.js"
import { getSessionFromRawHeaders } from "./infra/auth.js"
import {
  buildDeckSpreadsheetExport,
  enqueueDeckSpreadsheetImportJob,
} from "./domains/deck-spreadsheet/deck-spreadsheet.service/index.js"
import {
  DECK_SPREADSHEET_UPLOAD_DIR,
  DECK_SPREADSHEET_UPLOAD_MAX_BYTES,
  DeckSpreadsheetError,
  deleteFileIfExists,
} from "./domains/deck-spreadsheet/deck-spreadsheet.shared.js"

const port = Number(process.env.SERVER_PORT ?? 3001)
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173"
const spreadsheetUploadMimeTypes = new Set([
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
])

type HttpError = Error & {
  statusCode: number
}

function isUserCreationDisabled() {
  return ["1", "true", "yes"].includes(
    (process.env.DISABLE_USER_CREATION ?? "").trim().toLowerCase()
  )
}

function isSignupRequest(pathname: string) {
  return pathname.split("/").includes("sign-up")
}

const isProd = process.env.NODE_ENV === "production"

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: !isProd,
          translateTime: "yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname,reqId,req.remoteAddress,req.remotePort",
          singleLine: true,
        },
      },
    },
  })

  await app.register(cors, {
    origin: clientOrigin,
    credentials: true,
  })

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: ANKI_IMPORT_UPLOAD_MAX_BYTES,
    },
  })

  // Mount better-auth as a catch-all under /api/auth/*
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    bodyLimit: 16 * 1024, // 16 KB — more than enough for auth payloads
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`)
      if (isUserCreationDisabled() && isSignupRequest(url.pathname)) {
        req.log.warn({ path: url.pathname }, "User creation is disabled")
        reply.status(403).send({ message: "User creation is disabled." })
        return
      }

      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers.set(k, v.join(", "))
        else if (v != null) headers.set(k, String(v))
      }
      const request = new Request(
        `${process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`}${url.pathname}${url.search}`,
        {
          method: req.method,
          headers,
          body:
            req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
        }
      )
      const response = await auth.handler(request)
      reply.status(response.status)
      response.headers.forEach((value, key) => {
        reply.header(key, value)
      })
      const text = await response.text()
      reply.send(text)
    },
  })

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
    },
  })

  app.route({
    method: "POST",
    url: "/api/imports/anki/upload",
    bodyLimit: ANKI_IMPORT_UPLOAD_MAX_BYTES,
    async handler(req, reply) {
      const body = await handleAnkiImportUpload(prisma, {
        rawHeaders: req.headers,
        getFile: () => req.file(),
      })

      reply.status(201).send(body)
    },
  })

  app.route({
    method: "GET",
    url: "/api/decks/:deckId/spreadsheet/export",
    async handler(req, reply) {
      const session = await getSessionFromRawHeaders(req.headers)
      if (!session?.user) {
        reply.status(401).send({ message: "Unauthorized." })
        return
      }

      const { deckId } = req.params as { deckId: string }
      let body: Awaited<ReturnType<typeof buildDeckSpreadsheetExport>>
      try {
        body = await buildDeckSpreadsheetExport(prisma, session.user.id, deckId)
      } catch (error) {
        if (error instanceof DeckSpreadsheetError && error.code === "NOT_FOUND") {
          reply.status(404).send({ message: error.message })
          return
        }
        throw error
      }

      reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="${body.filename}"`)
        .send(body.buffer)
    },
  })

  app.route({
    method: "POST",
    url: "/api/decks/:deckId/spreadsheet/import",
    bodyLimit: DECK_SPREADSHEET_UPLOAD_MAX_BYTES,
    async handler(req, reply) {
      const { deckId } = req.params as { deckId: string }
      const session = await getSessionFromRawHeaders(req.headers)
      if (!session?.user) {
        reply.status(401).send({ message: "Unauthorized." })
        return
      }

      let spreadsheetImport: Awaited<
        ReturnType<typeof writeDeckSpreadsheetUploadToStorage>
      > | null = null

      try {
        const part = await req.file()
        if (!part) throw createHttpError(400, "No file was uploaded.")
        const normalizedMime = (part.mimetype ?? "").toLowerCase()
        if (
          !part.filename ||
          extname(part.filename).toLowerCase() !== ".xlsx" ||
          (normalizedMime && !spreadsheetUploadMimeTypes.has(normalizedMime))
        ) {
          part.file.resume()
          throw createHttpError(400, "Only .xlsx spreadsheet uploads are supported.")
        }

        spreadsheetImport = await writeDeckSpreadsheetUploadToStorage(part.file, {
          deckId,
          userId: session.user.id,
          filename: basename(part.filename),
        })

        if (part.file.truncated || spreadsheetImport.fileSize > DECK_SPREADSHEET_UPLOAD_MAX_BYTES) {
          throw createHttpError(413, "The uploaded file exceeds the 20MB limit.")
        }

        const body = await enqueueDeckSpreadsheetImportJob(prisma, {
          deckId,
          userId: session.user.id,
          importId: spreadsheetImport.id,
        })
        spreadsheetImport = null

        reply.status(201).send(body)
      } catch (error) {
        await deleteFileIfExists(spreadsheetImport?.storagePath)
        if (spreadsheetImport) {
          await prisma.spreadsheetImport.deleteMany({
            where: { id: spreadsheetImport.id, userId: session.user.id },
          })
        }

        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "FST_REQ_FILE_TOO_LARGE"
        ) {
          throw createHttpError(413, "The uploaded file exceeds the 20MB limit.")
        }

        if (error instanceof DeckSpreadsheetError && error.code === "NOT_FOUND") {
          throw createHttpError(404, error.message)
        }

        throw error
      }
    },
  })

  app.get("/health", async () => ({ ok: true }))

  return app
}

function createHttpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode })
}

async function writeDeckSpreadsheetUploadToStorage(
  fileStream: NodeJS.ReadableStream,
  input: {
    deckId: string
    userId: string
    filename: string
  }
) {
  const uploadDir = resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
  await mkdir(uploadDir, { recursive: true })

  const storagePath = join(uploadDir, `${Date.now()}-${randomUUID()}.xlsx`)
  let fileSize = 0
  const countBytes = new Transform({
    transform(chunk, _encoding, callback) {
      fileSize += chunk.length
      callback(null, chunk)
    },
  })

  try {
    await pipeline(fileStream, countBytes, createWriteStream(storagePath))

    return await prisma.spreadsheetImport.create({
      data: {
        userId: input.userId,
        deckId: input.deckId,
        filename: input.filename,
        fileSize,
        storagePath,
        status: SpreadsheetImportStatus.UPLOADED,
      },
    })
  } catch (error) {
    await deleteFileIfExists(storagePath)
    throw error
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  app
    .listen({ port, host: "0.0.0.0" })
    .then(() => {
      console.log(`Server listening on http://localhost:${port}`)
    })
    .catch((err) => {
      app.log.error(err)
      process.exit(1)
    })
}
