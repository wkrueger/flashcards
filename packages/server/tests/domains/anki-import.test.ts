import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/infra/mailer.js", () => ({
  sendMail: vi.fn(),
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

import type { FastifyInstance } from "fastify"
import FormData from "form-data"
import AdmZip from "adm-zip"
import Database from "better-sqlite3"
import { buildServer } from "../../src/main.js"
import { prisma } from "../../src/infra/db.js"
import {
  runAnalyzeAnkiImportJob,
  runImportAnkiImportJob,
} from "../../src/domains/anki-import/anki-import.service.js"
import { callerFor, makeUser, resetDomain } from "../helpers.js"

const FIELD_SEPARATOR = "\u001f"

type ApkgFixtureOptions = {
  includeCollection21?: boolean
  duplicateImportRows?: boolean
  importRows?: string[][]
}

let app: FastifyInstance
const tempDirs = new Set<string>()

async function createApkgFixture(options: ApkgFixtureOptions = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "anki-import-fixture-"))
  tempDirs.add(dir)

  const dbPath = path.join(
    dir,
    options.includeCollection21 === false ? "collection.anki2" : "collection.anki21"
  )
  const db = new Database(dbPath)

  db.exec(`
    CREATE TABLE col (models TEXT NOT NULL);
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      mid INTEGER NOT NULL,
      flds TEXT NOT NULL
    );
  `)

  const models = {
    "101": {
      id: 101,
      name: "LoF-German-Standard",
      type: 0,
      flds: [
        { name: "German", ord: 0 },
        { name: "English", ord: 1 },
        { name: "Audio", ord: 2 },
      ],
    },
    "202": {
      id: 202,
      name: "LoF-General-Cloze",
      type: 1,
      flds: [
        { name: "Text", ord: 0 },
        { name: "Translation", ord: 1 },
      ],
    },
  }

  db.prepare("INSERT INTO col(models) VALUES (?)").run(JSON.stringify(models))

  const importRows = options.importRows
    ? options.importRows
    : options.duplicateImportRows
      ? [
          ["Haus", "House", "[sound:haus.mp3]"],
          ["Haus", "House", ""],
        ]
      : [
          ["Haus", "House", "[sound:haus.mp3]"],
          ["Baum<br>alt", 'Tree<img src="tree.jpg">', ""],
        ]

  let noteId = 1
  for (const row of importRows) {
    db.prepare("INSERT INTO notes(id, mid, flds) VALUES (?, ?, ?)").run(
      noteId++,
      101,
      row.join(FIELD_SEPARATOR)
    )
  }

  db.prepare("INSERT INTO notes(id, mid, flds) VALUES (?, ?, ?)").run(
    noteId++,
    202,
    ["{{c1::gehen}}", "to go"].join(FIELD_SEPARATOR)
  )

  db.close()

  const zip = new AdmZip()
  if (options.includeCollection21 === false) {
    zip.addLocalFile(dbPath, "", "collection.anki2")
  } else {
    zip.addLocalFile(dbPath, "", "collection.anki21")
    zip.addLocalFile(dbPath, "", "collection.anki2")
  }
  zip.addFile("meta", Buffer.from([0x08, 0x02]))

  const archivePath = path.join(dir, "fixture.apkg")
  await writeFile(archivePath, zip.toBuffer())

  return {
    archivePath,
    async toFormData(filename = "fixture.apkg") {
      const form = new FormData()
      form.append("file", await readFile(archivePath), {
        filename,
        contentType: "application/zip",
      })
      return form
    },
  }
}

async function signUpAndGetCookie(ipSuffix: string) {
  const email = `anki-${ipSuffix}@test.local`
  const signUpResponse = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      name: `user-${ipSuffix}`,
      email,
      password: "password123",
    },
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${ipSuffix}`,
    },
  })

  expect(signUpResponse.statusCode).toBeLessThan(400)

  await prisma.user.update({
    where: { email },
    data: { emailVerified: true },
  })

  const signInResponse = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: {
      email,
      password: "password123",
    },
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${ipSuffix}`,
    },
  })

  expect(signInResponse.statusCode).toBeLessThan(400)

  const setCookie = signInResponse.headers["set-cookie"]
  const values = Array.isArray(setCookie) ? setCookie : [setCookie]
  return values
    .filter(Boolean)
    .map((value) => value!.split(";")[0])
    .join("; ")
}

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })))
})

beforeEach(async () => {
  await resetDomain()
})

describe("anki import upload endpoint", () => {
  it("accepts valid .apkg uploads and enqueues analysis", async () => {
    const cookie = await signUpAndGetCookie("10")
    const fixture = await createApkgFixture()
    const form = await fixture.toFormData()

    const response = await app.inject({
      method: "POST",
      url: "/api/imports/anki/upload",
      headers: {
        ...form.getHeaders(),
        cookie,
      },
      payload: form.getBuffer(),
    })

    expect(response.statusCode).toBe(201)
    const body = response.json<{ processId: string }>()
    expect(body.processId).toBeTruthy()

    const process = await prisma.importProcess.findUnique({
      where: { id: body.processId },
      include: { workerJobs: true },
    })

    expect(process).toMatchObject({
      status: "ANALYZING",
      filename: "fixture.apkg",
    })
    expect(process?.workerJobs).toHaveLength(1)
    expect(process?.workerJobs[0]).toMatchObject({
      type: "ANALYZE_ANKI_IMPORT",
      status: "PENDING",
    })
  })

  it("rejects files without the .apkg extension", async () => {
    const cookie = await signUpAndGetCookie("11")
    const fixture = await createApkgFixture()
    const form = await fixture.toFormData("fixture.zip")

    const response = await app.inject({
      method: "POST",
      url: "/api/imports/anki/upload",
      headers: {
        ...form.getHeaders(),
        cookie,
      },
      payload: form.getBuffer(),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ message: string }>().message).toContain(".apkg")
  })

  it("enforces the free-user per-user upload limit", async () => {
    const cookie = await signUpAndGetCookie("12")
    const fixture = await createApkgFixture()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const form = await fixture.toFormData()
      const response = await app.inject({
        method: "POST",
        url: "/api/imports/anki/upload",
        headers: {
          ...form.getHeaders(),
          cookie,
        },
        payload: form.getBuffer(),
      })

      if (attempt === 0) {
        expect(response.statusCode).toBe(201)
      } else {
        expect(response.statusCode).toBe(429)
      }
    }
  })

  it("cleans up stale incomplete imports before accepting a new upload", async () => {
    const cookie = await signUpAndGetCookie("13")
    const stalePath = path.resolve(process.cwd(), ".uploads/anki-imports/stale.apkg")
    await mkdir(path.dirname(stalePath), { recursive: true })
    await writeFile(stalePath, "stale")

    const userId = await makeUser("stale-owner")
    const oldCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const staleProcess = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "stale.apkg",
        fileSize: 5,
        storagePath: stalePath,
        createdAt: oldCreatedAt,
        updatedAt: oldCreatedAt,
      },
    })

    const fixture = await createApkgFixture()
    const form = await fixture.toFormData()
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/anki/upload",
      headers: {
        ...form.getHeaders(),
        cookie,
      },
      payload: form.getBuffer(),
    })

    expect(response.statusCode).toBe(201)
    expect(await prisma.importProcess.findUnique({ where: { id: staleProcess.id } })).toBeNull()
  })

  it("enforces the global free-user upload limit", async () => {
    for (let index = 0; index < 5; index += 1) {
      const userId = await makeUser(`global-${index}`)
      await prisma.importProcess.create({
        data: {
          userId,
          status: "ANALYZING",
          filename: `existing-${index}.apkg`,
          fileSize: 10,
          storagePath: `/tmp/existing-${index}.apkg`,
        },
      })
    }

    const cookie = await signUpAndGetCookie("14")
    const fixture = await createApkgFixture()
    const form = await fixture.toFormData()
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/anki/upload",
      headers: {
        ...form.getHeaders(),
        cookie,
      },
      payload: form.getBuffer(),
    })

    expect(response.statusCode).toBe(429)
  })
})

describe("anki import worker flow", () => {
  it("analyzes collection.anki21 metadata and stores card type samples", async () => {
    const userId = await makeUser("analyzer")
    const fixture = await createApkgFixture()
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const analyzed = await prisma.importProcess.findUnique({
      where: { id: process.id },
      include: { cardTypes: true },
    })

    expect(analyzed).toMatchObject({
      status: "AWAITING_CONFIGURATION",
      detectedCollectionFile: "collection.anki21",
      rowCount: 3,
    })
    expect(analyzed?.cardTypes).toHaveLength(2)
    expect(analyzed?.cardTypes[0]?.rowCount).toBeGreaterThan(0)
  })

  it("falls back to collection.anki2 when collection.anki21 is absent", async () => {
    const userId = await makeUser("fallback")
    const fixture = await createApkgFixture({ includeCollection21: false })
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const analyzed = await prisma.importProcess.findUnique({
      where: { id: process.id },
    })
    expect(analyzed?.detectedCollectionFile).toBe("collection.anki2")
  })

  it("saves mappings and stores sanitized preview cards", async () => {
    const userId = await makeUser("preview")
    const fixture = await createApkgFixture()
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const trpc = callerFor(userId)
    const configured = await trpc.ankiImport.saveConfiguration({
      id: process.id,
      deck: {
        name: "Imported deck",
        defaultFrontLanguageId: null,
        defaultBackLanguageId: null,
        inverseReviewEnabled: true,
      },
      cardTypes: [
        {
          modelKey: "101",
          selected: true,
          subjectField: "German",
          cardMappings: [{ frontField: "English", backField: "German" }],
        },
        {
          modelKey: "202",
          selected: false,
        },
      ],
    })

    const previewType = configured.cardTypes.find((cardType) => cardType.modelKey === "101")
    expect(previewType?.previewCards).toEqual([
      {
        subjectText: "Haus",
        front: "House",
        back: "Haus",
      },
      {
        subjectText: "Baum\nalt",
        front: "Tree",
        back: "Baum\nalt",
      },
    ])
  })

  it("imports mapped cards into a new deck and deletes the source file", async () => {
    const userId = await makeUser("importer")
    const fixture = await createApkgFixture()
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const trpc = callerFor(userId)
    await trpc.ankiImport.saveConfiguration({
      id: process.id,
      deck: {
        name: "Imported deck",
        defaultFrontLanguageId: null,
        defaultBackLanguageId: null,
      },
      cardTypes: [
        {
          modelKey: "101",
          selected: true,
          subjectField: "German",
          cardMappings: [{ frontField: "English", backField: "German" }],
        },
        {
          modelKey: "202",
          selected: false,
        },
      ],
    })

    await runImportAnkiImportJob(prisma, process.id)

    const finished = await prisma.importProcess.findUnique({
      where: { id: process.id },
    })
    const deck = await prisma.deck.findFirst({
      where: { userId, name: "Imported deck" },
    })
    const cards = await prisma.card.findMany({
      where: { deckId: deck?.id },
      orderBy: { front: "asc" },
    })

    expect(finished).toMatchObject({
      status: "SUCCEEDED",
      importedCardCount: 2,
    })
    expect(deck).not.toBeNull()
    expect(cards).toHaveLength(2)
    await expect(readFile(fixture.archivePath)).rejects.toThrow()
  })

  it("highlights only the matched words for multi-word highlight plugins", async () => {
    const userId = await makeUser("highlight-words")
    const fixture = await createApkgFixture({
      importRows: [["Guten Tag", "A very good and warm day", "good day"]],
    })
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const trpc = callerFor(userId)
    await trpc.ankiImport.saveConfiguration({
      id: process.id,
      deck: {
        name: "Imported deck",
        defaultFrontLanguageId: null,
        defaultBackLanguageId: null,
      },
      cardTypes: [
        {
          modelKey: "101",
          selected: true,
          subjectField: "German",
          cardMappings: [{ frontField: "English", backField: "German" }],
          plugins: [
            {
              type: "highlight_words",
              frontWordsField: "Audio",
              backWordsField: "Audio",
            },
          ],
        },
        {
          modelKey: "202",
          selected: false,
        },
      ],
    })

    await runImportAnkiImportJob(prisma, process.id)

    const deck = await prisma.deck.findFirst({
      where: { userId, name: "Imported deck" },
    })
    const cards = await prisma.card.findMany({
      where: { deckId: deck?.id },
      orderBy: { front: "asc" },
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]?.front).toBe("A very **good** and warm **day**")
  })

  it("fails the import during dry-run validation when mapped cards would duplicate", async () => {
    const userId = await makeUser("duplicate")
    const fixture = await createApkgFixture({ duplicateImportRows: true })
    const process = await prisma.importProcess.create({
      data: {
        userId,
        status: "ANALYZING",
        filename: "fixture.apkg",
        fileSize: 10,
        storagePath: fixture.archivePath,
      },
    })

    await runAnalyzeAnkiImportJob(prisma, process.id)

    const trpc = callerFor(userId)
    await trpc.ankiImport.saveConfiguration({
      id: process.id,
      deck: {
        name: "Imported deck",
        defaultFrontLanguageId: null,
        defaultBackLanguageId: null,
      },
      cardTypes: [
        {
          modelKey: "101",
          selected: true,
          subjectField: "German",
          cardMappings: [{ frontField: "English", backField: "German" }],
        },
        {
          modelKey: "202",
          selected: false,
        },
      ],
    })

    await runImportAnkiImportJob(prisma, process.id)

    const finished = await prisma.importProcess.findUnique({
      where: { id: process.id },
    })
    const deck = await prisma.deck.findFirst({
      where: { userId, name: "Imported deck" },
    })

    expect(finished).toMatchObject({
      status: "FAILED",
      errorSummary: "Import validation failed.",
    })
    expect(deck).toBeNull()
    await expect(readFile(fixture.archivePath)).rejects.toThrow()
  })
})
