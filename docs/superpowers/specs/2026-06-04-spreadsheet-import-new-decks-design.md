# Spreadsheet import — support importing new decks

Date: 2026-06-04

## Goal

The spreadsheet feature today only edits an existing deck (cards-only) via
`/api/decks/:deckId/spreadsheet/import`. Expand it so a user can **import a whole
new deck** from a spreadsheet, and download an **empty template** to fill in.

## Context (verified in codebase)

- **Deck name is already unique per user**: `@@unique([userId, name])` on `Deck`
  (schema.prisma) and `decks.create` rejects duplicates with a tRPC `CONFLICT`.
  No new uniqueness work needed.
- **Existing import is already scoped to one deck**: deckId is in the URL and
  `readMetaDeckId` rejects the upload when the Meta `deckId` ≠ target deck. This
  requirement is already satisfied; the existing per-deck edit flow stays as-is.
- **Import is async**: upload → store file → `SpreadsheetImport` row → worker job
  runs `applySpreadsheetRows(deckId)`. Status polled via `deckSpreadsheet.getImport`.
- **Stale uploads** are garbage-collected by age off `SpreadsheetImport` rows.

## Decisions (locked with user)

1. **Update mode = cards only.** Meta deck-config fields apply only when creating
   a new deck. Updating an existing deck ignores Meta config (today's behavior).
2. **Languages written by name** in the Meta tab (`Language.name`, e.g. `English`,
   `Deutsch`). Blank = none. Unknown non-blank name = row error.
3. **New flow lives on a dedicated page** `/imports/spreadsheet` (mirrors the Anki
   importer at `/imports/anki/new`).

## Section 1 — Spreadsheet format

### Meta tab (key/value, expanded)

| key                        | value (example)                | notes                         |
| -------------------------- | ------------------------------ | ----------------------------- |
| `deckId`                   | `clx…` (blank for fresh decks) | unchanged semantics           |
| `name`                     | `German A1`                    | deck name                     |
| `defaultFrontLanguage`     | `English`                      | `Language.name`; blank = none |
| `defaultBackLanguage`      | `Deutsch`                      | `Language.name`; blank = none |
| `speechRecognitionEnabled` | `true`                         | bool                          |
| `inverseReviewEnabled`     | `false`                        | bool                          |
| `sequentialEnabled`        | `false`                        | bool                          |

- `Card` tab unchanged (same `CARD_HEADERS`).
- **Export** (`buildDeckSpreadsheetExport`) writes the full Meta config, resolving
  language ids → names.
- **Template** = empty workbook: Meta with all keys (deckId blank, name blank,
  booleans showing defaults `true/false/false`), Card tab headers only.
- New `readMetaConfig(workbook)` parser: language by name (blank→none, unknown
  non-blank→error); booleans accept `true/false/1/0/yes/no`.

## Section 2 — Backend flow + endpoints

Reuse the async worker infra. Make `SpreadsheetImport.deckId` **nullable**
(migration) so an upload can exist before a deck is chosen. The existing per-deck
edit flow keeps setting `deckId` immediately.

1. **`GET /api/decks/spreadsheet/template`** (HTTP) — returns the empty template
   xlsx. No deckId.
2. **`POST /api/decks/spreadsheet/import`** (HTTP, multipart — new deck-level
   route, separate from the existing `/api/decks/:deckId/spreadsheet/import`).
   Stores the file, parses Meta in-memory, creates a `SpreadsheetImport` row with
   `deckId = null`, status `UPLOADED`. Returns:
   ```
   { importId, metaDeckId, suggestedName, existingDeck: { id, name } | null }
   ```
   `existingDeck` is non-null **only if** `metaDeckId` is present AND owned by the
   current user; otherwise the import is treated as new.
3. **`deckSpreadsheet.confirmImport`** (tRPC) — `{ importId, mode: "update" |
"create", name? }`:
   - **create**: validate `name` (non-blank, unique per user — reuse the
     `decks.create` conflict check), re-read the stored file for Meta config,
     create an empty deck (name + languages-by-name + toggles), set
     `import.deckId`, enqueue the job.
   - **update**: assert `metaDeckId` is owned, set `import.deckId = metaDeckId`,
     enqueue the job. Config ignored (cards-only).
   - Returns `{ importId }`. Status polled via existing `getImport`.

Stale-file cleanup already keys off `SpreadsheetImport` rows + age, so unconfirmed
uploads are garbage-collected for free.

## Section 3 — New-deck card-id handling

Exported `id` values reference the **source** deck's cards. In create mode the new
deck has none, so id-matching would error on every row.

`applySpreadsheetRows` gains a flag `ignoreRowIds: boolean`:

- **create** → `ignoreRowIds = true`: every row is a new card (skip id-match and
  skip the delete-by-blank-front path). Duplicate rows surface via the existing
  `(subjectId, frontHash)` uniqueness error.
- **update** → `ignoreRowIds = false`: unchanged (match/update/delete by id).

Edge: a blank `front`+`back` with an id means "delete" in update mode; in create
mode that row has no front → existing "front is required" error. Correct.

## Section 4 — Frontend

**Deck list page** — two new kebab `menuItems` (next to "Import Anki"):

- **Import deck** (FileUp) → `navigate({ to: "/imports/spreadsheet" })`.
- **Download template** (FileDown) → `window.location.href =
"/api/decks/spreadsheet/template"`.

**New route** `routes/(app)/imports/spreadsheet.tsx` → thin shell importing a new
`DeckSpreadsheetNewImportPage` in `domains/DeckSpreadsheet/`. The existing
per-deck `DeckSpreadsheetImportPage` is untouched.

**`DeckSpreadsheetNewImportPage` — two phases:**

- _Phase 1 (upload):_ file picker (reuse existing dropzone markup) → POST to the
  deck-level `/import` → store `{ importId, metaDeckId, suggestedName,
existingDeck }`.
- _Phase 2 (prompt):_
  - `existingDeck` present → choice: "Update existing deck **{name}**" or
    "Create new deck" (reveals name `Input` prefilled with `suggestedName`).
  - `existingDeck` null → straight to name `Input` prefilled with `suggestedName`
    (create-only).
  - Name validates non-blank; confirm CONFLICT surfaces inline for edit + retry.
- _Confirm:_ call `confirmImport` → poll `getImport` (reuse existing status card:
  created/updated/deleted + errors). On `SUCCEEDED`, "Go to deck" navigates to the
  resolved deckId; invalidate `decks.list` / `decks.get`.

## Section 5 — QA (first-class deliverables)

- **Typecheck** `pnpm typecheck` green (nullable `deckId` ripples through service
  types; client gets new `confirmImport` types).
- **ESLint** `pnpm lint` (client) — new page + menu items, no new plugins.
- **Vitest integration** (`packages/server/tests/domains/`):
  - Template export returns valid xlsx with Meta config keys.
  - Round-trip: export deck → import as **new** deck (different name) → cards
    created, source ids ignored, no "not found" error.
  - Import referencing **owned** metaDeckId → `existingDeck` returned; confirm
    `update` → cards-only sync, deck config unchanged.
  - Import referencing metaDeckId owned by **another user** → treated as new.
  - `confirmImport` create with **duplicate name** → CONFLICT.
  - Unknown language name in Meta → row error.
  - Per-user scoping preserved.
- **Playwright e2e** — deck list → Import deck → upload → name prompt → confirm →
  land on the new deck with cards.
- **Manual**: run `pnpm format`; delete a sticky `e2e.db` before re-running e2e.
