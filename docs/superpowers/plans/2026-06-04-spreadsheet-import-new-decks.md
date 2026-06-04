# Spreadsheet Import — New Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import a whole new deck from a spreadsheet (plus download an empty template), reusing the existing async import worker, while keeping the existing per-deck edit-import unchanged.

**Architecture:** The Meta worksheet grows from a single `deckId` row into a deck-config block (name, languages by name, toggles). A deck-level upload endpoint stores the file and _inspects_ it (no deck chosen yet); the client then prompts update-vs-new and a deck name; a tRPC `confirmImport` mutation creates the deck if needed and enqueues the existing worker job. New decks set an `ignoreRowIds` flag so exported row ids from a source deck are treated as fresh cards.

**Tech Stack:** Fastify + tRPC + Prisma + SQLite (server), ExcelJS (xlsx), React 18 + TanStack Router/Query (client), Vitest + Playwright (tests).

**Spec:** `docs/superpowers/specs/2026-06-04-spreadsheet-import-new-decks-design.md`

---

## File Structure

**Server**

- `packages/server/prisma/schema.prisma` — `SpreadsheetImport.deckId` becomes nullable; add `ignoreRowIds Boolean @default(false)`.
- `packages/shared/src/Schemas.ts` — add `confirmDeckImportInput`, `DeckSpreadsheetInspectResult`; make `SpreadsheetImportStatusView.deckId` nullable.
- `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetShared.ts` — widen `DeckSpreadsheetError` code union.
- `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/workbook.ts` — `META_CONFIG_KEYS`, `MetaConfig`, `readMetaConfig`, `parseMetaBool` (keep `readMetaDeckId`).
- `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/index.ts` — Meta config in export, `buildDeckSpreadsheetTemplate`, `inspectPendingImport`, `confirmDeckSpreadsheetImport`, `resolveLanguageIdByName`, relax worker guard for `ignoreRowIds`.
- `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/importRows.ts` — `ignoreRowIds` flag.
- `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetRouter.ts` — `confirmImport` mutation.
- `packages/server/src/main.ts` — `GET /api/decks/spreadsheet/template`, `POST /api/decks/spreadsheet/import`; allow null deckId in `writeDeckSpreadsheetUploadToStorage`.

**Client**

- `packages/client/src/domains/Decks/DeckListPage.tsx` — two new kebab menu items.
- `packages/client/src/routes/(app)/imports.spreadsheet.tsx` — route shell (new).
- `packages/client/src/domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage.tsx` — two-phase import page (new).

**Tests**

- `packages/server/tests/domains/DeckSpreadsheet.test.ts` — new cases.
- `packages/client/e2e/happy-path.spec.ts` (or new spec) — new-deck import e2e.

---

## Task 1: Schema — nullable deckId + ignoreRowIds

**Files:**

- Modify: `packages/server/prisma/schema.prisma:299-319`

- [ ] **Step 1: Edit the model**

In `model SpreadsheetImport`, change the `deckId`/`deck` lines and add `ignoreRowIds`:

```prisma
  deckId           String?
  deck             Deck?                   @relation(fields: [deckId], references: [id], onDelete: Cascade)
  ignoreRowIds     Boolean                 @default(false)
```

(Leave every other field unchanged. The matching `spreadsheetImports SpreadsheetImport[]` back-relation on `Deck` stays as-is.)

- [ ] **Step 2: Create the migration**

Run: `pnpm --filter server exec prisma migrate dev --name spreadsheet_import_new_deck`
Expected: new folder under `packages/server/prisma/migrations/`, Prisma client regenerated, no errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL — existing code reads `spreadsheetImport.deckId` as `string`; nullability now surfaces type errors in `index.ts` / `main.ts`. These are fixed in later tasks. (If it unexpectedly passes, that's fine too.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations
git commit -m "feat(db): make SpreadsheetImport.deckId nullable, add ignoreRowIds"
```

---

## Task 2: Shared schemas + types

**Files:**

- Modify: `packages/shared/src/Schemas.ts` (near `idInput` ~line 38, and `SpreadsheetImportStatusView` ~line 248)

- [ ] **Step 1: Add the confirm input + inspect result type**

After the `export const idInput = z.object({ id })` line, add:

```ts
export const confirmDeckImportInput = z
  .object({
    importId: z.string().min(1).max(64),
    mode: z.enum(["update", "create"]),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "create" && !data.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A deck name is required.",
        path: ["name"],
      })
    }
  })

export type DeckSpreadsheetInspectResult = {
  importId: string
  metaDeckId: string | null
  suggestedName: string
  existingDeck: { id: string; name: string } | null
}
```

- [ ] **Step 2: Make the status view deckId nullable**

In `export type SpreadsheetImportStatusView`, change:

```ts
deckId: string | null
```

- [ ] **Step 3: Typecheck the shared package**

Run: `pnpm --filter @cards/shared exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/Schemas.ts
git commit -m "feat(shared): confirmDeckImportInput + inspect result type"
```

---

## Task 3: Widen DeckSpreadsheetError code union

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetShared.ts:14-21`

- [ ] **Step 1: Edit the class**

Replace the `DeckSpreadsheetError` class with:

```ts
export class DeckSpreadsheetError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT"
  ) {
    super(message)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter server exec tsc --noEmit`
Expected: still failing on nullable `deckId` from Task 1 (fixed later), but no NEW errors from this change.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetShared.ts
git commit -m "feat(server): widen DeckSpreadsheetError codes"
```

---

## Task 4: workbook.ts — Meta config parser + bool

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/workbook.ts`
- Test: `packages/server/tests/domains/DeckSpreadsheet.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block inside the top-level `describe("deck spreadsheet import/export", …)` in `DeckSpreadsheet.test.ts` (place it just before the final closing `})` of that block). Add the import at the top of the file alongside the existing workbook imports:

```ts
import { readMetaConfig } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/workbook.js"
```

Test:

```ts
describe("readMetaConfig", () => {
  it("parses deck config from the Meta tab", async () => {
    const dir = path.resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `meta-${Date.now()}-${Math.random()}.xlsx`)
    const workbook = new ExcelJS.Workbook()
    const meta = workbook.addWorksheet("Meta")
    meta.addRow(["key", "value"])
    meta.addRow(["deckId", "deck-123"])
    meta.addRow(["name", "German A1"])
    meta.addRow(["defaultFrontLanguage", "English"])
    meta.addRow(["defaultBackLanguage", "Deutsch"])
    meta.addRow(["speechRecognitionEnabled", "false"])
    meta.addRow(["inverseReviewEnabled", "true"])
    meta.addRow(["sequentialEnabled", ""])
    await workbook.xlsx.writeFile(filePath)

    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.readFile(filePath)
    expect(readMetaConfig(loaded)).toEqual({
      deckId: "deck-123",
      name: "German A1",
      defaultFrontLanguage: "English",
      defaultBackLanguage: "Deutsch",
      speechRecognitionEnabled: false,
      inverseReviewEnabled: true,
      sequentialEnabled: false,
    })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "parses deck config"`
Expected: FAIL — `readMetaConfig` is not exported.

- [ ] **Step 3: Implement readMetaConfig + parseMetaBool**

Append to `workbook.ts` (after `readMetaDeckId`, keeping that function intact):

```ts
export const META_CONFIG_KEYS = {
  deckId: "deckId",
  name: "name",
  defaultFrontLanguage: "defaultFrontLanguage",
  defaultBackLanguage: "defaultBackLanguage",
  speechRecognitionEnabled: "speechRecognitionEnabled",
  inverseReviewEnabled: "inverseReviewEnabled",
  sequentialEnabled: "sequentialEnabled",
} as const

export type MetaConfig = {
  deckId: string
  name: string
  defaultFrontLanguage: string
  defaultBackLanguage: string
  speechRecognitionEnabled: boolean
  inverseReviewEnabled: boolean
  sequentialEnabled: boolean
}

export function readMetaConfig(workbook: ExcelJS.Workbook): MetaConfig {
  const worksheet = getRequiredWorksheet(workbook, "Meta")
  const headers = headerMap(worksheet)
  const keyColumn = requiredHeader(headers, "key")
  const valueColumn = requiredHeader(headers, "value")

  const values = new Map<string, string>()
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const key = cellText(row, keyColumn)
    if (key) values.set(key, cellText(row, valueColumn))
  }

  return {
    deckId: values.get(META_CONFIG_KEYS.deckId) ?? "",
    name: values.get(META_CONFIG_KEYS.name) ?? "",
    defaultFrontLanguage: values.get(META_CONFIG_KEYS.defaultFrontLanguage) ?? "",
    defaultBackLanguage: values.get(META_CONFIG_KEYS.defaultBackLanguage) ?? "",
    speechRecognitionEnabled: parseMetaBool(
      values.get(META_CONFIG_KEYS.speechRecognitionEnabled),
      true
    ),
    inverseReviewEnabled: parseMetaBool(values.get(META_CONFIG_KEYS.inverseReviewEnabled), false),
    sequentialEnabled: parseMetaBool(values.get(META_CONFIG_KEYS.sequentialEnabled), false),
  }
}

function parseMetaBool(raw: string | undefined, fallback: boolean): boolean {
  const value = (raw ?? "").trim().toLowerCase()
  if (!value) return fallback
  if (["true", "1", "yes", "y"].includes(value)) return true
  if (["false", "0", "no", "n"].includes(value)) return false
  throw new Error(`Meta value "${raw}" must be true or false.`)
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "parses deck config"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/workbook.ts packages/server/tests/domains/DeckSpreadsheet.test.ts
git commit -m "feat(server): readMetaConfig parses deck config from Meta tab"
```

---

## Task 5: Export writes Meta config + template builder

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/index.ts:23-81`
- Test: `packages/server/tests/domains/DeckSpreadsheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top-level describe in `DeckSpreadsheet.test.ts`. Add the import at the top alongside the other index imports:

```ts
import { buildDeckSpreadsheetTemplate } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/index.js"
```

Tests:

```ts
it("export writes deck config into the Meta tab", async () => {
  const userId = await makeUser("alice")
  const trpc = callerFor(userId)
  const front = await prisma.language.create({ data: { name: "ExportFront", emoji: "🇬🇧" } })
  const back = await prisma.language.create({ data: { name: "ExportBack", emoji: "🇩🇪" } })
  const deck = await trpc.decks.create({
    name: "Configured",
    defaultFrontLanguageId: front.id,
    defaultBackLanguageId: back.id,
    sequentialEnabled: true,
  })

  const { buffer } = await buildDeckSpreadsheetExport(prisma, userId, deck.id)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const config = readMetaConfig(wb)
  expect(config).toMatchObject({
    deckId: deck.id,
    name: "Configured",
    defaultFrontLanguage: "ExportFront",
    defaultBackLanguage: "ExportBack",
    sequentialEnabled: true,
  })
})

it("builds an empty template workbook", async () => {
  const { filename, buffer } = await buildDeckSpreadsheetTemplate()
  expect(filename).toBe("deck-template.xlsx")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const config = readMetaConfig(wb)
  expect(config.deckId).toBe("")
  expect(config.name).toBe("")
  expect(config.speechRecognitionEnabled).toBe(true)
  expect(wb.getWorksheet("Card")?.getCell("A1").text).toBe("id")
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "Meta tab"`
Expected: FAIL — `buildDeckSpreadsheetTemplate` undefined / Meta lacks `name` row.

- [ ] **Step 3: Update the import list and add the shared Meta helper**

At the top of `index.ts`, extend the `workbook.js` import to include the new names:

```ts
import {
  CARD_HEADERS,
  META_CONFIG_KEYS,
  assertNoDuplicateTagNames,
  readCardRows,
  readMetaConfig,
  readMetaDeckId,
} from "./workbook.js"
```

Add this helper near the bottom of `index.ts` (next to `assertOwnDeck`):

```ts
function addMetaSheet(
  workbook: ExcelJS.Workbook,
  config: {
    deckId: string
    name: string
    frontLanguage: string
    backLanguage: string
    speechRecognitionEnabled: boolean
    inverseReviewEnabled: boolean
    sequentialEnabled: boolean
  }
) {
  const meta = workbook.addWorksheet("Meta")
  meta.addRow(["key", "value"])
  meta.addRow([META_CONFIG_KEYS.deckId, config.deckId])
  meta.addRow([META_CONFIG_KEYS.name, config.name])
  meta.addRow([META_CONFIG_KEYS.defaultFrontLanguage, config.frontLanguage])
  meta.addRow([META_CONFIG_KEYS.defaultBackLanguage, config.backLanguage])
  meta.addRow([META_CONFIG_KEYS.speechRecognitionEnabled, String(config.speechRecognitionEnabled)])
  meta.addRow([META_CONFIG_KEYS.inverseReviewEnabled, String(config.inverseReviewEnabled)])
  meta.addRow([META_CONFIG_KEYS.sequentialEnabled, String(config.sequentialEnabled)])
  meta.columns = [{ width: 24 }, { width: 40 }]
}
```

- [ ] **Step 4: Rewrite the export's deck fetch + Meta block**

In `buildDeckSpreadsheetExport`, replace the opening `const deck = await assertOwnDeck(...)` line with a richer fetch, and replace the existing 4-line Meta block (`const meta = workbook.addWorksheet("Meta")` … `meta.columns = [...]`) with a single `addMetaSheet` call:

```ts
const deck = await prisma.deck.findFirst({
  where: { id: deckId, userId },
  include: {
    defaultFrontLanguage: { select: { name: true } },
    defaultBackLanguage: { select: { name: true } },
  },
})
if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")
```

```ts
addMetaSheet(workbook, {
  deckId: deck.id,
  name: deck.name,
  frontLanguage: deck.defaultFrontLanguage?.name ?? "",
  backLanguage: deck.defaultBackLanguage?.name ?? "",
  speechRecognitionEnabled: deck.speechRecognitionEnabled,
  inverseReviewEnabled: deck.inverseReviewEnabled,
  sequentialEnabled: deck.sequentialEnabled,
})
```

- [ ] **Step 5: Add the template builder**

Add to `index.ts` (exported, near `buildDeckSpreadsheetExport`):

```ts
export async function buildDeckSpreadsheetTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Cards"
  workbook.created = new Date()

  addMetaSheet(workbook, {
    deckId: "",
    name: "",
    frontLanguage: "",
    backLanguage: "",
    speechRecognitionEnabled: true,
    inverseReviewEnabled: false,
    sequentialEnabled: false,
  })

  const cardSheet = workbook.addWorksheet("Card")
  cardSheet.addRow([...CARD_HEADERS])
  cardSheet.columns = [
    { width: 28 },
    { width: 24 },
    { width: 12 },
    { width: 48 },
    { width: 48 },
    { width: 12 },
    { width: 28 },
  ]

  const buffer = await workbook.xlsx.writeBuffer()
  return { filename: "deck-template.xlsx", buffer: Buffer.from(buffer) }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts`
Expected: PASS, including the existing export test (it asserts `A2 === "deckId"` and `B2 === deck.id`, still true).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/index.ts packages/server/tests/domains/DeckSpreadsheet.test.ts
git commit -m "feat(server): export writes Meta config; add template builder"
```

---

## Task 6: importRows — ignoreRowIds flag

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/importRows.ts:7-90`
- Test: `packages/server/tests/domains/DeckSpreadsheet.test.ts`

- [ ] **Step 1: Write the failing test**

Add the import at the top of the test file:

```ts
import { applySpreadsheetRows } from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/importRows.js"
```

Test (add to the top-level describe):

```ts
it("ignoreRowIds treats every row as a new card", async () => {
  const userId = await makeUser("alice")
  const deck = await prisma.deck.create({ data: { name: "Fresh", userId } })
  const result = await prisma.$transaction((tx) =>
    applySpreadsheetRows(tx, {
      userId,
      deckId: deck.id,
      ignoreRowIds: true,
      rows: [
        {
          rowNumber: 2,
          id: "source-deck-card-id",
          subjectName: "S",
          subjectOrder: null,
          front: "f1",
          back: "b1",
          cardOrder: null,
          tagNames: [],
        },
      ],
    })
  )
  expect(result).toMatchObject({ rowCount: 1, createdCardCount: 1, updatedCardCount: 0 })
  const cards = await prisma.card.findMany({ where: { deckId: deck.id } })
  expect(cards).toHaveLength(1)
  expect(cards[0].id).not.toBe("source-deck-card-id")
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "ignoreRowIds treats"`
Expected: FAIL — `applySpreadsheetRows` has no `ignoreRowIds` param (TS) / card-not-found at runtime.

- [ ] **Step 3: Add the flag + use a local rowId**

In `applySpreadsheetRows`, change the `input` type to include the flag:

```ts
  input: {
    userId: string
    deckId: string
    rows: SpreadsheetRow[]
    ignoreRowIds?: boolean
  }
```

At the very top of the `for (const row of input.rows)` loop body, replace the first lines (down through `const isDelete = ...`) with a `rowId` local and use it everywhere `row.id` was used in this iteration:

```ts
const logPrefix = `Row ${row.rowNumber}:`
const rowId = input.ignoreRowIds ? "" : row.id

if (rowId && seenIds.has(rowId)) {
  throw new Error(`${logPrefix} duplicate card id "${rowId}".`)
}
if (rowId) seenIds.add(rowId)

const isDelete = !!rowId && !row.front && !row.back
```

Then within this same iteration, replace the remaining `row.id` references:

- delete branch: `where: { id: rowId, deckId: input.deckId, deck: { userId: input.userId } }`
- create guard: `if (!rowId) {`
- update fetch: `where: { id: rowId, deckId: input.deckId, deck: { userId: input.userId } }`

(Do not touch `row.front`, `row.back`, `row.subjectName`, etc.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "ignoreRowIds treats"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/importRows.ts packages/server/tests/domains/DeckSpreadsheet.test.ts
git commit -m "feat(server): applySpreadsheetRows ignoreRowIds option"
```

---

## Task 7: Worker guard + inspect + confirm service

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/index.ts` (`runDeckSpreadsheetImportJob` ~153-199; add new exports)
- Test: `packages/server/tests/domains/DeckSpreadsheet.test.ts`

- [ ] **Step 1: Write the failing test (new-deck end-to-end + scoping + conflict)**

Add a helper near the top of the test file (after `queueSpreadsheetImport`):

```ts
async function createPendingImport(userId: string, storagePath: string) {
  return prisma.spreadsheetImport.create({
    data: {
      userId,
      deckId: null,
      filename: path.basename(storagePath),
      fileSize: 100,
      storagePath,
      status: "UPLOADED",
    },
  })
}

async function writeConfigWorkbook(
  meta: Record<string, string>,
  rows: Array<{ id?: string; subjectName?: string; front?: string; back?: string }>
) {
  const dir = path.resolve(process.cwd(), DECK_SPREADSHEET_UPLOAD_DIR)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `cfg-${Date.now()}-${Math.random()}.xlsx`)
  const workbook = new ExcelJS.Workbook()
  const metaSheet = workbook.addWorksheet("Meta")
  metaSheet.addRow(["key", "value"])
  for (const [key, value] of Object.entries(meta)) metaSheet.addRow([key, value])
  const card = workbook.addWorksheet("Card")
  card.addRow(["id", "subjectName", "subjectOrder", "front", "back", "cardOrder", "tags"])
  for (const row of rows) {
    card.addRow([row.id ?? "", row.subjectName ?? "", "", row.front ?? "", row.back ?? "", "", ""])
  }
  await workbook.xlsx.writeFile(filePath)
  return filePath
}
```

Add the import for the service functions at the top of the file:

```ts
import {
  confirmDeckSpreadsheetImport,
  inspectPendingImport,
} from "../../src/domains/DeckSpreadsheet/deckSpreadsheetService/index.js"
```

Tests (add a nested `describe`):

```ts
describe("new deck import", () => {
  it("creates a new deck and imports its cards, ignoring source ids", async () => {
    const userId = await makeUser("alice")
    const storagePath = await writeConfigWorkbook(
      { deckId: "old-source-deck", name: "Suggested" },
      [{ id: "old-source-deck-card", subjectName: "S", front: "f", back: "b" }]
    )
    const pending = await createPendingImport(userId, storagePath)

    const inspect = await inspectPendingImport(prisma, userId, pending.id)
    expect(inspect).toMatchObject({ metaDeckId: "old-source-deck", existingDeck: null })
    expect(inspect.suggestedName).toBe("Suggested")

    const { deckId } = await confirmDeckSpreadsheetImport(prisma, userId, {
      importId: pending.id,
      mode: "create",
      name: "Brand New Deck",
    })
    expect(await runNextWorkerJob(prisma)).toBe(true)

    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    expect(deck.name).toBe("Brand New Deck")
    const cards = await prisma.card.findMany({ where: { deckId } })
    expect(cards).toHaveLength(1)
    expect(cards[0].front).toBe("f")
  })

  it("returns existingDeck only when the metaDeckId belongs to the user", async () => {
    const userId = await makeUser("alice")
    const other = await makeUser("bob")
    const trpc = callerFor(userId)
    const mine = await trpc.decks.create({ name: "Mine" })
    const theirs = await callerFor(other).decks.create({ name: "Theirs" })

    const ownPath = await writeConfigWorkbook({ deckId: mine.id, name: "Mine" }, [])
    const ownPending = await createPendingImport(userId, ownPath)
    const ownInspect = await inspectPendingImport(prisma, userId, ownPending.id)
    expect(ownInspect.existingDeck).toMatchObject({ id: mine.id, name: "Mine" })

    const foreignPath = await writeConfigWorkbook({ deckId: theirs.id, name: "Theirs" }, [])
    const foreignPending = await createPendingImport(userId, foreignPath)
    const foreignInspect = await inspectPendingImport(prisma, userId, foreignPending.id)
    expect(foreignInspect.existingDeck).toBeNull()
  })

  it("rejects create when the deck name is already taken", async () => {
    const userId = await makeUser("alice")
    await callerFor(userId).decks.create({ name: "Dup" })
    const storagePath = await writeConfigWorkbook({ name: "Dup" }, [])
    const pending = await createPendingImport(userId, storagePath)
    await expect(
      confirmDeckSpreadsheetImport(prisma, userId, {
        importId: pending.id,
        mode: "create",
        name: "Dup",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("rejects create when a Meta language name is unknown", async () => {
    const userId = await makeUser("alice")
    const storagePath = await writeConfigWorkbook(
      { name: "X", defaultFrontLanguage: "Klingon" },
      []
    )
    const pending = await createPendingImport(userId, storagePath)
    await expect(
      confirmDeckSpreadsheetImport(prisma, userId, {
        importId: pending.id,
        mode: "create",
        name: "X Deck",
      })
    ).rejects.toThrow(/Klingon/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "new deck import"`
Expected: FAIL — `inspectPendingImport` / `confirmDeckSpreadsheetImport` not exported.

- [ ] **Step 3: Relax the worker guard for ignoreRowIds**

In `runDeckSpreadsheetImportJob`, replace the block from `const metaDeckId = readMetaDeckId(workbook)` through the `applySpreadsheetRows(...)` call with:

```ts
if (!spreadsheetImport.ignoreRowIds) {
  const metaDeckId = readMetaDeckId(workbook)
  if (metaDeckId !== spreadsheetImport.deckId) {
    throw new Error("Spreadsheet deckId does not match this deck.")
  }
}
const rows = readCardRows(workbook)

const result = await prisma.$transaction(async (tx) => {
  await assertOwnDeck(tx, spreadsheetImport.userId, spreadsheetImport.deckId!)
  return applySpreadsheetRows(tx, {
    userId: spreadsheetImport.userId,
    deckId: spreadsheetImport.deckId!,
    rows,
    ignoreRowIds: spreadsheetImport.ignoreRowIds,
  })
})
```

Then in the trailing `markDeckCompletionStale(prisma, spreadsheetImport.deckId)` call, change it to `spreadsheetImport.deckId!`.

- [ ] **Step 4: Add inspect + confirm + language resolver**

Add these exported functions to `index.ts` (after `enqueueDeckSpreadsheetImportJob`). Ensure `WorkerJobType` and `DeckSpreadsheetError` are imported (both already are), and add the type import for the inspect result:

```ts
import type { DeckSpreadsheetInspectResult, SpreadsheetImportStatusView } from "@cards/shared"
```

(The file already imports `SpreadsheetImportStatusView`; extend that import line to include `DeckSpreadsheetInspectResult` rather than duplicating.)

```ts
export async function inspectPendingImport(
  prisma: PrismaClient,
  userId: string,
  importId: string
): Promise<DeckSpreadsheetInspectResult> {
  const item = await prisma.spreadsheetImport.findFirst({ where: { id: importId, userId } })
  if (!item) throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")

  let config
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(item.storagePath)
    config = readMetaConfig(workbook)
  } catch (error) {
    throw new DeckSpreadsheetError(
      error instanceof Error ? error.message : "Could not read the spreadsheet.",
      "BAD_REQUEST"
    )
  }

  let existingDeck: { id: string; name: string } | null = null
  if (config.deckId) {
    existingDeck = await prisma.deck.findFirst({
      where: { id: config.deckId, userId },
      select: { id: true, name: true },
    })
  }

  return {
    importId: item.id,
    metaDeckId: config.deckId || null,
    suggestedName: config.name || existingDeck?.name || "",
    existingDeck,
  }
}

export async function confirmDeckSpreadsheetImport(
  prisma: PrismaClient,
  userId: string,
  input: { importId: string; mode: "update" | "create"; name?: string }
) {
  const item = await prisma.spreadsheetImport.findFirst({
    where: { id: input.importId, userId },
  })
  if (!item) throw new DeckSpreadsheetError("Spreadsheet import not found.", "NOT_FOUND")
  if (item.workerJobId)
    throw new DeckSpreadsheetError("This import was already started.", "BAD_REQUEST")

  let config
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(item.storagePath)
    config = readMetaConfig(workbook)
  } catch (error) {
    throw new DeckSpreadsheetError(
      error instanceof Error ? error.message : "Could not read the spreadsheet.",
      "BAD_REQUEST"
    )
  }

  let deckId: string
  let ignoreRowIds: boolean

  if (input.mode === "create") {
    const name = (input.name ?? "").trim()
    if (!name) throw new DeckSpreadsheetError("A deck name is required.", "BAD_REQUEST")
    const existing = await prisma.deck.findFirst({ where: { userId, name } })
    if (existing) {
      throw new DeckSpreadsheetError("A deck with that name already exists.", "CONFLICT")
    }
    const defaultFrontLanguageId = await resolveLanguageIdByName(
      prisma,
      config.defaultFrontLanguage
    )
    const defaultBackLanguageId = await resolveLanguageIdByName(prisma, config.defaultBackLanguage)
    const deck = await prisma.deck.create({
      data: {
        name,
        userId,
        defaultFrontLanguageId,
        defaultBackLanguageId,
        speechRecognitionEnabled: config.speechRecognitionEnabled,
        inverseReviewEnabled: config.inverseReviewEnabled,
        sequentialEnabled: config.sequentialEnabled,
      },
    })
    deckId = deck.id
    ignoreRowIds = true
  } else {
    if (!config.deckId) {
      throw new DeckSpreadsheetError("The spreadsheet has no deckId to update.", "BAD_REQUEST")
    }
    const deck = await prisma.deck.findFirst({
      where: { id: config.deckId, userId },
      select: { id: true },
    })
    if (!deck) throw new DeckSpreadsheetError("Deck not found.", "NOT_FOUND")
    deckId = deck.id
    ignoreRowIds = false
  }

  await prisma.$transaction(async (tx) => {
    const job = await tx.workerJob.create({
      data: { type: WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT },
    })
    await tx.spreadsheetImport.update({
      where: { id: item.id },
      data: { deckId, ignoreRowIds, workerJobId: job.id },
    })
  })

  return { importId: item.id, deckId }
}

async function resolveLanguageIdByName(prisma: DbClient, name: string): Promise<number | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const language = await prisma.language.findFirst({
    where: { name: trimmed },
    select: { id: true },
  })
  if (!language) {
    throw new DeckSpreadsheetError(`Language "${trimmed}" was not found.`, "BAD_REQUEST")
  }
  return language.id
}
```

- [ ] **Step 5: Run the new-deck tests + the whole spreadsheet suite**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts`
Expected: PASS (all cases, including the pre-existing edit-flow tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetService/index.ts packages/server/tests/domains/DeckSpreadsheet.test.ts
git commit -m "feat(server): inspect + confirm import; new-deck worker path"
```

---

## Task 8: tRPC confirmImport mutation

**Files:**

- Modify: `packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetRouter.ts`
- Test: `packages/server/tests/domains/DeckSpreadsheet.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `new deck import` describe in the test file:

```ts
it("exposes confirmImport over tRPC and maps conflicts", async () => {
  const userId = await makeUser("alice")
  const trpc = callerFor(userId)
  await trpc.decks.create({ name: "Taken" })
  const storagePath = await writeConfigWorkbook({ name: "Taken" }, [])
  const pending = await createPendingImport(userId, storagePath)
  await expect(
    trpc.deckSpreadsheet.confirmImport({
      importId: pending.id,
      mode: "create",
      name: "Taken",
    })
  ).rejects.toMatchObject({ code: "CONFLICT" })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "exposes confirmImport"`
Expected: FAIL — `confirmImport` is not a procedure.

- [ ] **Step 3: Implement the mutation**

Replace `deckSpreadsheetRouter.ts` with:

```ts
import { confirmDeckImportInput, idInput } from "@cards/shared"
import { TRPCError } from "@trpc/server"
import { protectedProcedure, router } from "../../infra/trpc.js"
import {
  confirmDeckSpreadsheetImport,
  getSpreadsheetImportStatus,
} from "./deckSpreadsheetService/index.js"
import { DeckSpreadsheetError } from "./deckSpreadsheetShared.js"

const errorCodeMap = {
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
} as const

export const deckSpreadsheetRouter = router({
  getImport: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    return getSpreadsheetImportStatus(ctx.prisma, ctx.user.id, input.id)
  }),

  confirmImport: protectedProcedure
    .input(confirmDeckImportInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmDeckSpreadsheetImport(ctx.prisma, ctx.user.id, input)
      } catch (error) {
        if (error instanceof DeckSpreadsheetError) {
          throw new TRPCError({ code: errorCodeMap[error.code], message: error.message })
        }
        throw error
      }
    }),
})
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter server exec vitest run tests/domains/DeckSpreadsheet.test.ts -t "exposes confirmImport"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domains/DeckSpreadsheet/deckSpreadsheetRouter.ts packages/server/tests/domains/DeckSpreadsheet.test.ts
git commit -m "feat(server): deckSpreadsheet.confirmImport mutation"
```

---

## Task 9: HTTP routes — template + deck-level inspect upload

**Files:**

- Modify: `packages/server/src/main.ts` (imports ~21-31; add routes near the existing spreadsheet routes ~171; `writeDeckSpreadsheetUploadToStorage` ~255-292)

- [ ] **Step 1: Extend the service import**

In `main.ts`, change the import from the spreadsheet service to:

```ts
import {
  buildDeckSpreadsheetExport,
  buildDeckSpreadsheetTemplate,
  enqueueDeckSpreadsheetImportJob,
  inspectPendingImport,
} from "./domains/DeckSpreadsheet/deckSpreadsheetService/index.js"
```

- [ ] **Step 2: Allow a null deckId when storing**

In `writeDeckSpreadsheetUploadToStorage`, change the `input.deckId` parameter type to `string | null`:

```ts
async function writeDeckSpreadsheetUploadToStorage(
  fileStream: NodeJS.ReadableStream,
  input: {
    deckId: string | null
    userId: string
    filename: string
  }
) {
```

(The `prisma.spreadsheetImport.create` `data.deckId` now accepts null — no other change in this function.)

- [ ] **Step 3: Add the template route**

Add immediately after the existing `GET /api/decks/:deckId/spreadsheet/export` route block:

```ts
app.route({
  method: "GET",
  url: "/api/decks/spreadsheet/template",
  async handler(req, reply) {
    const session = await getSessionFromRawHeaders(req.headers)
    if (!session?.user) {
      reply.status(401).send({ message: "Unauthorized." })
      return
    }

    const body = await buildDeckSpreadsheetTemplate()
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${body.filename}"`)
      .send(body.buffer)
  },
})
```

- [ ] **Step 4: Add the deck-level inspect-upload route**

Add after the template route (this is the no-`:deckId` sibling of the existing import route; Fastify gives the static path priority over the parametric one):

```ts
app.route({
  method: "POST",
  url: "/api/decks/spreadsheet/import",
  bodyLimit: DECK_SPREADSHEET_UPLOAD_MAX_BYTES,
  async handler(req, reply) {
    const session = await getSessionFromRawHeaders(req.headers)
    if (!session?.user) {
      reply.status(401).send({ message: "Unauthorized." })
      return
    }

    let spreadsheetImport: Awaited<ReturnType<typeof writeDeckSpreadsheetUploadToStorage>> | null =
      null

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
        deckId: null,
        userId: session.user.id,
        filename: basename(part.filename),
      })

      if (part.file.truncated || spreadsheetImport.fileSize > DECK_SPREADSHEET_UPLOAD_MAX_BYTES) {
        throw createHttpError(413, "The uploaded file exceeds the 20MB limit.")
      }

      const result = await inspectPendingImport(prisma, session.user.id, spreadsheetImport.id)
      spreadsheetImport = null

      reply.status(201).send(result)
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

      if (error instanceof DeckSpreadsheetError) {
        throw createHttpError(error.code === "NOT_FOUND" ? 404 : 400, error.message)
      }

      throw error
    }
  },
})
```

- [ ] **Step 5: Typecheck the server**

Run: `pnpm --filter server exec tsc --noEmit`
Expected: PASS (nullable `deckId` now consistently handled).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/main.ts
git commit -m "feat(server): template download + deck-level inspect upload routes"
```

---

## Task 10: Deck list — Import deck + Download template buttons

**Files:**

- Modify: `packages/client/src/domains/Decks/DeckListPage.tsx` (import line ~20; `menuItems` block ~277-287)

- [ ] **Step 1: Add the icons to the import**

Change the lucide import line:

```tsx
import { FileDown, FileText, FileUp, Plus } from "lucide-react"
```

- [ ] **Step 2: Add the two menu items**

In the `menuItems` prop, after the existing "Import Anki" `MenuItem`, add:

```tsx
            <MenuItem
              onSelect={() => navigate({ to: "/imports/spreadsheet" })}
              icon={<FileUp className="h-[18px] w-[18px]" />}
              aria-label="Import deck from spreadsheet"
            >
              Import deck
            </MenuItem>
            <MenuItem
              onSelect={() => {
                window.location.href = "/api/decks/spreadsheet/template"
              }}
              icon={<FileText className="h-[18px] w-[18px]" />}
              aria-label="Download spreadsheet template"
            >
              Download template
            </MenuItem>
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS (no unused imports — `FileDown` still used by the Anki item).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/domains/Decks/DeckListPage.tsx
git commit -m "feat(client): deck list import-deck + download-template menu items"
```

---

## Task 11: New-import route shell + page

**Files:**

- Create: `packages/client/src/routes/(app)/imports.spreadsheet.tsx`
- Create: `packages/client/src/domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage.tsx`

- [ ] **Step 1: Create the route shell**

`packages/client/src/routes/(app)/imports.spreadsheet.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { DeckSpreadsheetNewImportPage } from "../../domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage"

export const Route = createFileRoute("/(app)/imports/spreadsheet")({
  component: DeckSpreadsheetNewImportPage,
})
```

- [ ] **Step 2: Create the page**

`packages/client/src/domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage.tsx`:

```tsx
import { useRef, useState } from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { FileSpreadsheet, Upload } from "lucide-react"
import type { DeckSpreadsheetInspectResult } from "@cards/shared"
import { PageHeader } from "../../components/AppShell"
import { trpc } from "../../infra/trpc"
import { Button } from "../../ui/Button"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"

type Mode = "update" | "create"

export function DeckSpreadsheetNewImportPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [inspect, setInspect] = useState<DeckSpreadsheetInspectResult | null>(null)
  const [mode, setMode] = useState<Mode>("create")
  const [name, setName] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmImport = trpc.deckSpreadsheet.confirmImport.useMutation()

  const importStatus = trpc.deckSpreadsheet.getImport.useQuery(
    { id: inspect?.importId ?? "" },
    {
      enabled: confirmed && !!inspect,
      refetchInterval: ({ state }) => {
        const status = state.data?.status
        return status && ["UPLOADED", "IMPORTING"].includes(status) ? 2_000 : false
      },
    }
  )

  const succeeded = importStatus.data?.status === "SUCCEEDED"
  const resolvedDeckId = importStatus.data?.deckId ?? null

  const upload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.set("file", file)
      const response = await fetch("/api/decks/spreadsheet/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const payload = (await response.json().catch(() => null)) as
        | (DeckSpreadsheetInspectResult & { message?: string })
        | null
      if (!response.ok || !payload?.importId) {
        throw new Error(payload?.message ?? "Could not read the spreadsheet.")
      }
      setInspect(payload)
      setMode(payload.existingDeck ? "update" : "create")
      setName(payload.suggestedName)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.")
    } finally {
      setUploading(false)
    }
  }

  const confirm = () => {
    if (!inspect) return
    setError(null)
    confirmImport.mutate(
      {
        importId: inspect.importId,
        mode,
        name: mode === "create" ? name.trim() : undefined,
      },
      {
        onSuccess: () => setConfirmed(true),
        onError: (mutationError) => setError(mutationError.message),
      }
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Import deck" onBack={() => router.history.back()} />

      {!inspect && (
        <div className="space-y-2">
          <Label htmlFor="spreadsheet-file">Spreadsheet file</Label>
          <input
            ref={inputRef}
            id="spreadsheet-file"
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-6 w-6" />
            <span className="font-medium text-foreground">
              {file ? "Choose a different file" : "Tap to choose a file"}
            </span>
            <span className="text-xs">
              Single <code>.xlsx</code> file, up to 20MB.
            </span>
          </button>
          {file && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                {file.name}
              </p>
            </div>
          )}
        </div>
      )}

      {inspect && !confirmed && (
        <div className="space-y-4">
          {inspect.existingDeck && (
            <div className="space-y-2">
              <Label>This spreadsheet matches an existing deck</Label>
              <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "update"}
                    onChange={() => setMode("update")}
                  />
                  <span>
                    Update existing deck <strong>{inspect.existingDeck.name}</strong>
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "create"}
                    onChange={() => setMode("create")}
                  />
                  <span>Create a new deck</span>
                </label>
              </div>
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-1">
              <Label htmlFor="new-deck-name">New deck name</Label>
              <Input
                id="new-deck-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. German A1"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {confirmed && importStatus.data && (
        <div className="space-y-2 rounded-md border bg-card p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Status</span>
            <span>{importStatus.data.status.toLowerCase()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold">{importStatus.data.createdCardCount}</p>
              <p className="text-xs text-muted-foreground">created</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{importStatus.data.updatedCardCount}</p>
              <p className="text-xs text-muted-foreground">updated</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{importStatus.data.deletedCardCount}</p>
              <p className="text-xs text-muted-foreground">deleted</p>
            </div>
          </div>
          {importStatus.data.errorSummary && (
            <p className="text-sm text-destructive">{importStatus.data.errorSummary}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="mt-auto space-y-2">
        {!inspect && (
          <Button className="w-full" onClick={upload} disabled={!file || uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Reading..." : "Upload spreadsheet"}
          </Button>
        )}

        {inspect && !confirmed && (
          <Button
            className="w-full"
            onClick={confirm}
            disabled={confirmImport.isPending || (mode === "create" && !name.trim())}
          >
            {confirmImport.isPending
              ? "Starting..."
              : mode === "update"
                ? "Update deck"
                : "Create deck"}
          </Button>
        )}

        {succeeded && resolvedDeckId && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              utils.decks.list.invalidate()
              utils.decks.get.invalidate({ id: resolvedDeckId })
              navigate({ to: "/decks/$deckId", params: { deckId: resolvedDeckId } })
            }}
          >
            Go to deck
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Regenerate the route tree + typecheck**

Run: `pnpm --filter client build`
Expected: PASS — `routeTree.gen.ts` now includes `/imports/spreadsheet`; client typechecks.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "packages/client/src/routes/(app)/imports.spreadsheet.tsx" packages/client/src/domains/DeckSpreadsheet/DeckSpreadsheetNewImportPage.tsx packages/client/src/routeTree.gen.ts
git commit -m "feat(client): new-deck spreadsheet import page"
```

---

## Task 12: E2E + full QA gate

**Files:**

- Modify: `packages/client/e2e/happy-path.spec.ts`

- [ ] **Step 1: Read the existing e2e to match its login/setup helpers**

Run: `sed -n '1,60p' packages/client/e2e/happy-path.spec.ts`
Expected: shows how the spec signs up / navigates (reuse its existing auth setup pattern verbatim in the new test).

- [ ] **Step 2: Add a new-deck import e2e**

Append a test that: signs up (reuse the spec's helper), exports nothing but instead uses the **Download template** path is skipped; instead drive the UI: open the deck-list kebab → click **Import deck** → set the file input to a fixture xlsx built in-test with `Meta` (name `E2E Imported`) + one `Card` row → click **Create deck** → assert the page reaches the success state and **Go to deck** appears. Build the fixture with `exceljs` in the test (already a dependency) and write it to a temp path, then `setInputFiles`.

Concretely (adapt selectors to the existing spec's conventions):

```ts
test("imports a brand new deck from a spreadsheet", async ({ page }) => {
  // reuse the spec's existing sign-up/login helper here

  const ExcelJS = (await import("exceljs")).default
  const os = await import("node:os")
  const path = await import("node:path")
  const wb = new ExcelJS.Workbook()
  const meta = wb.addWorksheet("Meta")
  meta.addRow(["key", "value"])
  meta.addRow(["name", "E2E Imported"])
  const card = wb.addWorksheet("Card")
  card.addRow(["id", "subjectName", "subjectOrder", "front", "back", "cardOrder", "tags"])
  card.addRow(["", "Hallo", "", "hello", "hallo", "", ""])
  const fixture = path.join(os.tmpdir(), `e2e-deck-${Date.now()}.xlsx`)
  await wb.xlsx.writeFile(fixture)

  await page.getByRole("button", { name: /menu|more|options/i }).click()
  await page.getByText("Import deck").click()
  await page.setInputFiles("#spreadsheet-file", fixture)
  await page.getByRole("button", { name: "Upload spreadsheet" }).click()
  await page.getByRole("button", { name: "Create deck" }).click()
  await expect(page.getByRole("button", { name: "Go to deck" })).toBeVisible({ timeout: 15_000 })
})
```

- [ ] **Step 3: Run e2e**

Run: `pnpm test:e2e`
Expected: PASS. If `packages/server/prisma/e2e.db` is sticky, delete it first: `rm -f packages/server/prisma/e2e.db`.

- [ ] **Step 4: Run the full quality gate**

Run: `pnpm format && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/e2e/happy-path.spec.ts
git commit -m "test(e2e): import a new deck from a spreadsheet"
```

---

## Notes for the implementer

- **Do not** modify the existing per-deck route `/api/decks/:deckId/spreadsheet/import` or `DeckSpreadsheetImportPage.tsx` — that edit flow stays.
- The existing edit flow keeps `ignoreRowIds = false` (column default) and the metaDeckId guard, so its behavior is unchanged.
- `pnpm test` shares one SQLite file with `singleFork`; `resetDomain()` already truncates `spreadsheetImport` and `.uploads`. The new tests create Language rows with unique names — they are not reset between tests, so always use distinct language names per test (as the tasks do).
- Prettier: run `pnpm format` before the final gate (printWidth 100, no semicolons).
