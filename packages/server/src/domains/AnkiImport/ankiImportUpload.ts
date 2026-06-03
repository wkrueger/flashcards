import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { getSessionFromRawHeaders } from "../../infra/auth.js"
import {
  ImportProcessStatus as PrismaImportProcessStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../generated/prisma/client.js"
import {
  INCOMPLETE_IMPORT_PROCESS_STATUSES,
  createHttpError,
  deleteFileIfExists,
  type HandleAnkiImportUploadInput,
  type UploadLimitResult,
  type UploadWriteResult,
} from "./anki-import.shared.js"

const ALLOWED_APKG_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
])

export const ANKI_IMPORT_UPLOAD_MAX_BYTES = 300 * 1024 * 1024
const FREE_USER_UPLOAD_WINDOW_MS = 10 * 60 * 1000
const FREE_USER_UPLOAD_MAX_PER_USER = 1
const FREE_USER_UPLOAD_MAX_GLOBAL = 5
const STALE_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const COMPLETED_IMPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function importStorageDir() {
  return resolve(process.cwd(), ".uploads/anki-imports")
}

function importStoragePath() {
  return join(importStorageDir(), `${Date.now()}-${randomUUID()}.apkg`)
}

function isApkgFilename(filename: string) {
  return extname(filename).toLowerCase() === ".apkg"
}

export function isSupportedApkgUpload(filename: string, mimetype: string | undefined) {
  const normalizedMime = (mimetype ?? "").toLowerCase()
  return (
    isApkgFilename(filename) && (!normalizedMime || ALLOWED_APKG_MIME_TYPES.has(normalizedMime))
  )
}

async function ensureImportStorageDir() {
  await mkdir(importStorageDir(), { recursive: true })
}

async function cleanupStaleImportProcesses(prisma: PrismaClient) {
  const staleCutoff = new Date(Date.now() - STALE_IMPORT_MAX_AGE_MS)
  const completedCutoff = new Date(Date.now() - COMPLETED_IMPORT_MAX_AGE_MS)

  const toDelete = await prisma.importProcess.findMany({
    where: {
      OR: [
        { status: { in: INCOMPLETE_IMPORT_PROCESS_STATUSES }, createdAt: { lt: staleCutoff } },
        {
          status: { in: ["SUCCEEDED", "FAILED"] },
          completedAt: { lt: completedCutoff },
        },
      ],
    },
    select: { id: true, storagePath: true },
  })

  if (toDelete.length === 0) {
    return 0
  }

  await Promise.all(toDelete.map((item) => deleteFileIfExists(item.storagePath)))
  await prisma.importProcess.deleteMany({
    where: { id: { in: toDelete.map((item) => item.id) } },
  })

  return toDelete.length
}

async function getUploadLimitResult(
  prisma: PrismaClient,
  userId: string
): Promise<UploadLimitResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })

  if (user?.plan !== "free") {
    return { allowed: true }
  }

  const cutoff = new Date(Date.now() - FREE_USER_UPLOAD_WINDOW_MS)
  const [userCount, globalCount] = await Promise.all([
    prisma.importProcess.count({
      where: {
        userId,
        createdAt: { gte: cutoff },
      },
    }),
    prisma.importProcess.count({
      where: {
        createdAt: { gte: cutoff },
        user: { is: { plan: "free" } },
      },
    }),
  ])

  if (userCount >= FREE_USER_UPLOAD_MAX_PER_USER) {
    return {
      allowed: false,
      message: "Free users can upload at most 1 Anki file every 10 minutes.",
    }
  }

  if (globalCount >= FREE_USER_UPLOAD_MAX_GLOBAL) {
    return {
      allowed: false,
      message: "Free-user Anki uploads are temporarily saturated. Try again in a few minutes.",
    }
  }

  return { allowed: true }
}

async function writeUploadStreamToStorage(
  fileStream: NodeJS.ReadableStream,
  storagePath = importStoragePath()
): Promise<UploadWriteResult> {
  await ensureImportStorageDir()

  let fileSize = 0

  const countBytes = new Transform({
    transform(chunk, _encoding, callback) {
      fileSize += chunk.length
      callback(null, chunk)
    },
  })

  await pipeline(fileStream, countBytes, createWriteStream(storagePath))

  return {
    fileSize,
    storagePath,
  }
}

async function createImportProcessForUpload(
  prisma: PrismaClient,
  input: {
    userId: string
    filename: string
    fileSize: number
    storagePath: string
  }
) {
  return prisma.$transaction(async (tx) => {
    const process = await tx.importProcess.create({
      data: {
        userId: input.userId,
        filename: basename(input.filename),
        fileSize: input.fileSize,
        storagePath: input.storagePath,
        status: PrismaImportProcessStatus.UPLOADED,
      },
    })

    await tx.workerJob.create({
      data: {
        processId: process.id,
        type: WorkerJobType.ANALYZE_ANKI_IMPORT,
      },
    })

    return tx.importProcess.update({
      where: { id: process.id },
      data: { status: PrismaImportProcessStatus.ANALYZING },
      include: { cardTypes: true },
    })
  })
}

export async function handleAnkiImportUpload(
  prisma: PrismaClient,
  input: HandleAnkiImportUploadInput
) {
  const session = await getSessionFromRawHeaders(input.rawHeaders)

  if (!session?.user) {
    throw createHttpError(401, "Unauthorized.")
  }

  await cleanupStaleImportProcesses(prisma)

  const uploadLimit = await getUploadLimitResult(prisma, session.user.id)
  if (!uploadLimit.allowed) {
    throw createHttpError(429, uploadLimit.message ?? "Upload limit reached.")
  }

  let storagePath: string | null = null

  try {
    const part = await input.getFile()

    if (!part) {
      throw createHttpError(400, "No file was uploaded.")
    }

    if (!part.filename || !isSupportedApkgUpload(part.filename, part.mimetype)) {
      part.file.resume()
      throw createHttpError(400, "Only .apkg Anki package uploads are supported.")
    }

    const upload = await writeUploadStreamToStorage(part.file)
    storagePath = upload.storagePath

    if (part.file.truncated || upload.fileSize > ANKI_IMPORT_UPLOAD_MAX_BYTES) {
      throw createHttpError(413, "The uploaded file exceeds the 300MB limit.")
    }

    const process = await createImportProcessForUpload(prisma, {
      userId: session.user.id,
      filename: part.filename,
      fileSize: upload.fileSize,
      storagePath,
    })

    return { processId: process.id }
  } catch (error) {
    await deleteFileIfExists(storagePath)

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_REQ_FILE_TOO_LARGE"
    ) {
      throw createHttpError(413, "The uploaded file exceeds the 300MB limit.")
    }

    throw error
  }
}
