import { mkdir } from "node:fs/promises"
import path from "node:path"
import AdmZip from "adm-zip"
import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it } from "vitest"
import { prisma } from "../../src/infra/db.js"
import { runNextWorkerJob } from "../../src/infra/worker.js"
import { extractSpreadsheetArchive } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/archive.js"
import {
  confirmDeckSpreadsheetImportBatch,
  getDeckSpreadsheetBatch,
} from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/batch.js"
import { DECK_SPREADSHEET_UPLOAD_DIR } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetShared.js"
import { callerFor, makeUser, resetDomain } from "../helpers.js"

async function xlsxBuffer(
  meta: Record<string, string>,
  rows: Array<{ id?: string; subjectName?: string; front?: string; back?: string }>
) {
  const workbook = new ExcelJS.Workbook()
  const metaSheet = workbook.addWorksheet("Meta")
  metaSheet.addRow(["key", "value"])
  for (const [key, value] of Object.entries(meta)) metaSheet.addRow([key, value])
  const card = workbook.addWorksheet("Card")
  card.addRow(["id", "subjectName", "subjectOrder", "front", "back", "cardOrder", "tags"])
  for (const row of rows) {
    card.addRow([row.id ?? "", row.subjectName ?? "", "", row.front ?? "", row.back ?? "", "", ""])
  }
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
}

async function makeZip(entries: Array<{ name: string; buffer: Buffer }>) {
  const dir = path.resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
  await mkdir(dir, { recursive: true })
  const zipPath = path.join(dir, `batch-${Date.now()}-${Math.random()}.zip`)
  const zip = new AdmZip()
  for (const entry of entries) zip.addFile(entry.name, entry.buffer)
  zip.writeZip(zipPath)
  return zipPath
}

describe("deck spreadsheet zip batch import", () => {
  beforeEach(async () => {
    await resetDomain()
  })

  it("extracts every .xlsx, ignoring junk entries, and inspects each", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const existing = await trpc.decks.create({ name: "Existing" })

    const zipPath = await makeZip([
      {
        name: "create.xlsx",
        buffer: await xlsxBuffer({ name: "Fresh" }, [{ subjectName: "S", front: "f", back: "b" }]),
      },
      {
        name: "update.xlsx",
        buffer: await xlsxBuffer({ deckId: existing.id, name: "Existing" }, []),
      },
      { name: "__MACOSX/._create.xlsx", buffer: Buffer.from("junk") },
      { name: "readme.txt", buffer: Buffer.from("not a spreadsheet") },
    ])

    const { batchId, items } = await extractSpreadsheetArchive(prisma, { userId, archivePath: zipPath })

    expect(items).toHaveLength(2)
    const createItem = items.find((item) => item.filename === "create.xlsx")!
    const updateItem = items.find((item) => item.filename === "update.xlsx")!
    expect(createItem.existingDeck).toBeNull()
    expect(createItem.suggestedName).toBe("Fresh")
    expect(updateItem.existingDeck).toMatchObject({ id: existing.id, name: "Existing" })

    const view = await getDeckSpreadsheetBatch(prisma, userId, batchId)
    expect(view.status).toBe("UPLOADED")
    expect(view.items).toHaveLength(2)
  })

  it("imports a mixed create/update batch in one pass", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const existing = await trpc.decks.create({ name: "Existing" })

    const zipPath = await makeZip([
      {
        name: "create.xlsx",
        buffer: await xlsxBuffer({ name: "Fresh" }, [
          { subjectName: "S1", front: "cf", back: "cb" },
        ]),
      },
      {
        name: "update.xlsx",
        buffer: await xlsxBuffer({ deckId: existing.id, name: "Existing" }, [
          { subjectName: "S2", front: "uf", back: "ub" },
        ]),
      },
    ])
    const { batchId, items } = await extractSpreadsheetArchive(prisma, { userId, archivePath: zipPath })

    await confirmDeckSpreadsheetImportBatch(prisma, userId, {
      items: items.map((item) => ({
        importId: item.importId,
        mode: item.existingDeck ? "update" : "create",
        name: item.existingDeck ? undefined : "Brand New",
      })),
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const view = await getDeckSpreadsheetBatch(prisma, userId, batchId)
    expect(view.status).toBe("SUCCEEDED")

    const fresh = await prisma.deck.findFirstOrThrow({ where: { userId, name: "Brand New" } })
    expect(await prisma.card.count({ where: { deckId: fresh.id } })).toBe(1)
    expect(await prisma.card.count({ where: { deckId: existing.id } })).toBe(1)
  })

  it("rolls back the whole batch when any spreadsheet fails (all-or-nothing)", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const existing = await trpc.decks.create({ name: "Existing" })

    const zipPath = await makeZip([
      {
        name: "create.xlsx",
        buffer: await xlsxBuffer({ name: "ShouldNotPersist" }, [
          { subjectName: "S", front: "f", back: "b" },
        ]),
      },
      {
        // Update row references a card id that does not exist -> throws at apply time.
        name: "update.xlsx",
        buffer: await xlsxBuffer({ deckId: existing.id, name: "Existing" }, [
          { id: "missing-card-id", subjectName: "S", front: "x", back: "y" },
        ]),
      },
    ])
    const { batchId, items } = await extractSpreadsheetArchive(prisma, { userId, archivePath: zipPath })

    await confirmDeckSpreadsheetImportBatch(prisma, userId, {
      items: items.map((item) => ({
        importId: item.importId,
        mode: item.existingDeck ? "update" : "create",
        name: item.existingDeck ? undefined : "ShouldNotPersist",
      })),
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const view = await getDeckSpreadsheetBatch(prisma, userId, batchId)
    expect(view.status).toBe("FAILED")
    // The new deck must not have been created, and the existing deck untouched.
    expect(await prisma.deck.count({ where: { userId, name: "ShouldNotPersist" } })).toBe(0)
    expect(await prisma.card.count({ where: { deckId: existing.id } })).toBe(0)
  })

  it("rejects a batch where two spreadsheets create the same deck name", async () => {
    const userId = await makeUser("alice")
    const zipPath = await makeZip([
      { name: "a.xlsx", buffer: await xlsxBuffer({ name: "Dup" }, []) },
      { name: "b.xlsx", buffer: await xlsxBuffer({ name: "Dup" }, []) },
    ])
    const { items } = await extractSpreadsheetArchive(prisma, { userId, archivePath: zipPath })

    await expect(
      confirmDeckSpreadsheetImportBatch(prisma, userId, {
        items: items.map((item) => ({ importId: item.importId, mode: "create", name: "Dup" })),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })

    // Nothing enqueued.
    expect(await prisma.workerJob.count()).toBe(0)
  })

  it("rejects an empty zip", async () => {
    const userId = await makeUser("alice")
    const zipPath = await makeZip([{ name: "readme.txt", buffer: Buffer.from("hi") }])
    await expect(
      extractSpreadsheetArchive(prisma, { userId, archivePath: zipPath })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("does not expose another user's batch", async () => {
    const alice = await makeUser("alice")
    const bob = await makeUser("bob")
    const zipPath = await makeZip([{ name: "a.xlsx", buffer: await xlsxBuffer({ name: "X" }, []) }])
    const { batchId } = await extractSpreadsheetArchive(prisma, { userId: alice, archivePath: zipPath })

    await expect(getDeckSpreadsheetBatch(prisma, bob, batchId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
})
