import { mkdir, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it } from "vitest"
import { WorkerJobStatus, WorkerJobType } from "../../src/generated/prisma/client.js"
import { prisma } from "../../src/infra/db.js"
import { runNextWorkerJob } from "../../src/infra/worker.js"
import { hashFront, SYSTEM_TAG_OWNER_KEY } from "../../src/domains/Cards/cardsService.js"
import {
  buildDeckSpreadsheetExport,
  cleanupStaleSpreadsheetImports,
} from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/index.js"
import { DECK_SPREADSHEET_UPLOAD_DIR } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetShared.js"
import { subjectKeyFor } from "../../src/domains/Subjects/subjectsService.js"
import { callerFor, makeUser, resetDomain } from "../helpers.js"

async function createUserTag(userId: string, name: string) {
  return prisma.tag.create({
    data: {
      ownerType: "USER",
      ownerKey: userId,
      userId,
      name,
    },
  })
}

async function writeWorkbook(
  deckId: string,
  rows: Array<{
    id?: string
    subjectName?: string
    subjectOrder?: number | string
    front?: string
    back?: string
    cardOrder?: number | string
    tags?: string
  }>
) {
  const dir = path.resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `test-${Date.now()}-${Math.random()}.xlsx`)
  const workbook = new ExcelJS.Workbook()
  const meta = workbook.addWorksheet("Meta")
  meta.addRow(["key", "value"])
  meta.addRow(["deckId", deckId])
  const card = workbook.addWorksheet("Card")
  card.addRow(["id", "subjectName", "subjectOrder", "front", "back", "cardOrder", "tags"])
  for (const row of rows) {
    card.addRow([
      row.id ?? "",
      row.subjectName ?? "",
      row.subjectOrder ?? "",
      row.front ?? "",
      row.back ?? "",
      row.cardOrder ?? "",
      row.tags ?? "",
    ])
  }
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

async function queueSpreadsheetImport(input: {
  userId: string
  deckId: string
  storagePath: string
  createdAt?: Date
}) {
  const job = await prisma.workerJob.create({
    data: { type: WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT },
  })
  const spreadsheetImport = await prisma.spreadsheetImport.create({
    data: {
      userId: input.userId,
      deckId: input.deckId,
      filename: path.basename(input.storagePath),
      fileSize: 100,
      storagePath: input.storagePath,
      workerJobId: job.id,
      createdAt: input.createdAt,
    },
  })
  return { job, spreadsheetImport }
}

describe("deck spreadsheet import/export", () => {
  beforeEach(async () => {
    await resetDomain()
  })

  it("exports a deck workbook with Meta and Card worksheets", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    const tag = await createUserTag(userId, "Noun")

    const subject = await prisma.subject.create({
      data: {
        userId,
        deckId: deck.id,
        subject: "Haus",
        subjectKey: subjectKeyFor("Haus"),
      },
    })
    const card = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "front",
        frontHash: hashFront("front"),
        back: "back",
        cardTags: { create: [{ tagId: tag.id }] },
      },
    })

    const exported = await buildDeckSpreadsheetExport(prisma, userId, deck.id)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(exported.buffer.buffer as ArrayBuffer)

    expect(workbook.getWorksheet("Meta")?.getCell("A1").text).toBe("key")
    expect(workbook.getWorksheet("Meta")?.getCell("A2").text).toBe("deckId")
    expect(workbook.getWorksheet("Meta")?.getCell("B2").text).toBe(deck.id)
    const cardSheet = workbook.getWorksheet("Card")!
    expect(cardSheet.getCell("A1").text).toBe("id")
    expect(cardSheet.getCell("A2").text).toBe(card.id)
    expect(cardSheet.getCell("B2").text).toBe("Haus")
    expect(cardSheet.getCell("G2").text).toBe("Noun")
  })

  it("updates, creates, deletes, and cleans up empty subjects from a spreadsheet import", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    const tag = await createUserTag(userId, "Noun")
    const oldSubject = await prisma.subject.create({
      data: {
        userId,
        deckId: deck.id,
        subject: "Old",
        subjectKey: subjectKeyFor("Old"),
      },
    })
    const deleteSubject = await prisma.subject.create({
      data: {
        userId,
        deckId: deck.id,
        subject: "Delete",
        subjectKey: subjectKeyFor("Delete"),
      },
    })
    const existing = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: oldSubject.id,
        front: "old front",
        frontHash: hashFront("old front"),
        back: "old back",
      },
    })
    const deleted = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: deleteSubject.id,
        front: "delete front",
        frontHash: hashFront("delete front"),
        back: "delete back",
      },
    })
    const storagePath = await writeWorkbook(deck.id, [
      {
        id: existing.id,
        subjectName: "New",
        front: "new front",
        back: "new back",
        tags: tag.name,
      },
      { subjectName: "Created", front: "created front", back: "created back", tags: tag.name },
      { id: deleted.id, front: "", back: "" },
    ])
    const { spreadsheetImport } = await queueSpreadsheetImport({
      userId,
      deckId: deck.id,
      storagePath,
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const importResult = await prisma.spreadsheetImport.findUnique({
      where: { id: spreadsheetImport.id },
    })
    expect(importResult).toMatchObject({
      status: "SUCCEEDED",
      rowCount: 3,
      createdCardCount: 1,
      updatedCardCount: 1,
      deletedCardCount: 1,
    })
    const cards = await prisma.card.findMany({
      where: { deckId: deck.id },
      include: { subject: true, cardTags: true },
      orderBy: { front: "asc" },
    })
    expect(cards.map((card) => [card.front, card.subject.subject])).toEqual([
      ["created front", "Created"],
      ["new front", "New"],
    ])
    expect(cards.every((card) => card.cardTags.length === 1)).toBe(true)
    await expect(
      prisma.subject.findUniqueOrThrow({ where: { id: oldSubject.id } })
    ).rejects.toThrow()
    await expect(
      prisma.subject.findUniqueOrThrow({ where: { id: deleteSubject.id } })
    ).rejects.toThrow()
    const job = await prisma.workerJob.findUniqueOrThrow({
      where: { id: spreadsheetImport.workerJobId! },
    })
    expect(job.status).toBe(WorkerJobStatus.SUCCEEDED)
  })

  it("skips update rows when all imported values match the current card", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    const tag = await createUserTag(userId, "Noun")
    const subject = await prisma.subject.create({
      data: {
        userId,
        deckId: deck.id,
        subject: "Haus",
        subjectKey: subjectKeyFor("Haus"),
      },
    })
    const card = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "front",
        frontHash: hashFront("front"),
        back: "back",
        cardTags: { create: [{ tagId: tag.id }] },
      },
    })
    const storagePath = await writeWorkbook(deck.id, [
      { id: card.id, subjectName: "Haus", front: "front", back: "back", tags: "Noun" },
    ])
    const { spreadsheetImport } = await queueSpreadsheetImport({
      userId,
      deckId: deck.id,
      storagePath,
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const importResult = await prisma.spreadsheetImport.findUniqueOrThrow({
      where: { id: spreadsheetImport.id },
    })
    expect(importResult).toMatchObject({
      status: "SUCCEEDED",
      rowCount: 1,
      createdCardCount: 0,
      updatedCardCount: 0,
      deletedCardCount: 0,
    })
    await expect(prisma.card.findUniqueOrThrow({ where: { id: card.id } })).resolves.toMatchObject({
      subjectId: subject.id,
      front: "front",
      back: "back",
    })
  })

  it("fails and rolls back when tags do not match exactly", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    await createUserTag(userId, "Noun")
    const subject = await prisma.subject.create({
      data: {
        userId,
        deckId: deck.id,
        subject: "Haus",
        subjectKey: subjectKeyFor("Haus"),
      },
    })
    const card = await prisma.card.create({
      data: {
        deckId: deck.id,
        subjectId: subject.id,
        front: "front",
        frontHash: hashFront("front"),
        back: "back",
      },
    })
    const storagePath = await writeWorkbook(deck.id, [
      { id: card.id, subjectName: "Haus", front: "changed", back: "changed", tags: "noun" },
    ])
    const { spreadsheetImport } = await queueSpreadsheetImport({
      userId,
      deckId: deck.id,
      storagePath,
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const importResult = await prisma.spreadsheetImport.findUniqueOrThrow({
      where: { id: spreadsheetImport.id },
    })
    expect(importResult.status).toBe("FAILED")
    expect(importResult.errorSummary).toContain('Tag "noun" was not found')
    await expect(prisma.card.findUniqueOrThrow({ where: { id: card.id } })).resolves.toMatchObject({
      front: "front",
      back: "back",
    })
  })

  it("fails when two visible tags have the same name", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    await createUserTag(userId, "shared")
    await prisma.tag.create({
      data: {
        ownerType: "SYSTEM",
        ownerKey: SYSTEM_TAG_OWNER_KEY,
        userId: null,
        name: "shared",
      },
    })
    const storagePath = await writeWorkbook(deck.id, [
      { subjectName: "Haus", front: "front", back: "back", tags: "shared" },
    ])
    const { spreadsheetImport } = await queueSpreadsheetImport({
      userId,
      deckId: deck.id,
      storagePath,
    })

    expect(await runNextWorkerJob(prisma)).toBe(true)

    const importResult = await prisma.spreadsheetImport.findUniqueOrThrow({
      where: { id: spreadsheetImport.id },
    })
    expect(importResult.status).toBe("FAILED")
    expect(importResult.errorSummary).toContain('Multiple tags named "shared"')
    await expect(prisma.card.count({ where: { deckId: deck.id } })).resolves.toBe(0)
  })

  it("cleans up stale spreadsheet import rows and orphan files", async () => {
    const userId = await makeUser("alice")
    const trpc = callerFor(userId)
    const deck = await trpc.decks.create({ name: "German" })
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const storagePath = await writeWorkbook(deck.id, [])
    const orphanPath = path.join(path.dirname(storagePath), "orphan.xlsx")
    await writeFile(orphanPath, "orphan")
    await utimes(orphanPath, oldDate, oldDate)
    const { spreadsheetImport } = await queueSpreadsheetImport({
      userId,
      deckId: deck.id,
      storagePath,
      createdAt: oldDate,
    })

    await cleanupStaleSpreadsheetImports(prisma)

    await expect(
      prisma.spreadsheetImport.findUnique({ where: { id: spreadsheetImport.id } })
    ).resolves.toBeNull()
    await expect(stat(storagePath)).rejects.toThrow()
    await expect(stat(orphanPath)).rejects.toThrow()
  })

  describe("order columns", () => {
    it("imports card and subject order, first subject appearance wins", async () => {
      const userId = await makeUser()
      const deck = await prisma.deck.create({ data: { name: "D", userId } })
      const storagePath = await writeWorkbook(deck.id, [
        { subjectName: "S", subjectOrder: 10, front: "f1", back: "b1", cardOrder: 2 },
        { subjectName: "S", subjectOrder: 99, front: "f2", back: "b2", cardOrder: 1 },
      ])
      await queueSpreadsheetImport({ userId, deckId: deck.id, storagePath })
      expect(await runNextWorkerJob(prisma)).toBe(true)

      const subject = await prisma.subject.findFirstOrThrow({ where: { deckId: deck.id } })
      expect(subject.order).toBe(10)
      const cards = await prisma.card.findMany({
        where: { deckId: deck.id },
        orderBy: { front: "asc" },
        select: { front: true, order: true },
      })
      expect(cards).toEqual([
        { front: "f1", order: 2 },
        { front: "f2", order: 1 },
      ])
    })

    it("export includes subjectOrder and cardOrder columns", async () => {
      const userId = await makeUser()
      const deck = await prisma.deck.create({ data: { name: "D", userId } })
      const subject = await prisma.subject.create({
        data: {
          deckId: deck.id,
          userId,
          subject: "S",
          subjectKey: subjectKeyFor("S"),
          randomKey: 1,
          order: 3,
        },
      })
      await prisma.card.create({
        data: {
          deckId: deck.id,
          subjectId: subject.id,
          front: "f",
          frontHash: hashFront("f"),
          back: "b",
          order: 7,
        },
      })
      const { buffer } = await buildDeckSpreadsheetExport(prisma, userId, deck.id)
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buffer as unknown as ArrayBuffer)
      const sheet = wb.getWorksheet("Card")!
      const header = sheet.getRow(1).values as string[]
      expect(header).toContain("subjectOrder")
      expect(header).toContain("cardOrder")
      const colOf = (name: string) => header.indexOf(name)
      const dataRow = sheet.getRow(2)
      expect(dataRow.getCell(colOf("subjectOrder")).text).toBe("3")
      expect(dataRow.getCell(colOf("cardOrder")).text).toBe("7")
    })
  })
})
