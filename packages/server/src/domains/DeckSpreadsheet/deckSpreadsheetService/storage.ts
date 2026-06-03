import { mkdir, readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import type { PrismaClient } from "../../../generated/prisma/client.js"
import {
  DECK_SPREADSHEET_UPLOAD_DIR,
  SPREADSHEET_IMPORT_CLEANUP_AGE_MS,
  deleteFileIfExists,
} from "../deckSpreadsheetShared.js"

export async function cleanupStaleSpreadsheetImports(prisma: PrismaClient) {
  const cutoff = new Date(Date.now() - SPREADSHEET_IMPORT_CLEANUP_AGE_MS)
  const staleRows = await prisma.spreadsheetImport.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, storagePath: true },
  })

  await Promise.all(staleRows.map((item) => deleteFileIfExists(item.storagePath)))
  if (staleRows.length > 0) {
    await prisma.spreadsheetImport.deleteMany({
      where: { id: { in: staleRows.map((item) => item.id) } },
    })
  }

  await ensureUploadStorageDir()
  const livePaths = new Set(
    (
      await prisma.spreadsheetImport.findMany({
        select: { storagePath: true },
      })
    ).map((item) => item.storagePath)
  )

  const files = await readdir(uploadStorageDir(), { withFileTypes: true })
  await Promise.all(
    files
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = join(uploadStorageDir(), entry.name)
        if (livePaths.has(filePath)) return
        const info = await stat(filePath)
        if (info.mtime.getTime() < cutoff.getTime()) {
          await deleteFileIfExists(filePath)
        }
      })
  )
}

function uploadStorageDir() {
  return resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
}

async function ensureUploadStorageDir() {
  await mkdir(uploadStorageDir(), { recursive: true })
}
