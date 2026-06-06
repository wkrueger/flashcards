# Zip multi-spreadsheet import — design

**Date:** 2026-06-06
**Status:** Implemented

## Summary

Extend the deck-detail "Import spreadsheet" flow to accept a `.zip` containing
multiple `.xlsx` spreadsheets, in addition to the existing single `.xlsx`. Each
spreadsheet in the zip self-routes to a deck via its `Meta` sheet, with a
per-file review screen and all-or-nothing import semantics.

## Decisions (from brainstorming)

- **Routing:** self-route via `Meta`. Each `.xlsx` resolves by its own Meta
  `deckId` — a matching owned deck updates; a missing/unknown deckId creates a
  new deck. The deck-detail page is only the entry point; the current deck is
  not a routing target for zip uploads.
- **Confirmation UX:** per-file editing. After upload, a review list lets the
  user flip each file create/update and edit new-deck names before running.
- **Review UI location:** dedicated route, not inline on the deck-detail page.
- **Failure mode:** all-or-nothing. If any spreadsheet fails (validation or at
  apply time), the whole batch imports nothing.

## Behavior

- Deck-detail import page accepts `.xlsx` **or** `.zip` (20MB limit).
  - `.xlsx` → unchanged: immediate enqueue, updates the current deck via its
    Meta `deckId`.
  - `.zip` → uploads to the archive endpoint, then navigates to the batch
    review route carrying `batchId` (and `deckId` for back-navigation context).
- Batch review: per file shows filename, update/create radio (defaults to
  update when the Meta deckId matched an owned deck, else create), editable
  new-deck name for create, and inline warnings. A single "Import N deck(s)"
  button runs the whole batch; afterward each file shows its status and
  created/updated/deleted counts, or the batch-level error on failure.

## All-or-nothing implementation

Deck creation is **deferred into the import transaction** so a later failure
rolls back created decks as well as cards.

- New `WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT_BATCH`. All rows in a batch
  share one `workerJobId`.
- `confirmImportBatch` only **validates** and **persists the plan** — no deck
  creation, no card writes. Validations: per-item ownership, create-needs-name,
  new-deck-name uniqueness within the batch and against existing decks,
  update-needs-valid-owned-Meta-deckId. Any failure rejects the whole confirm
  and enqueues nothing.
- The batch worker job runs **one `prisma.$transaction`**: per row, create the
  deck if needed (resolving Meta languages/flags) then apply rows. Any throw
  rolls back everything and the batch is marked `FAILED`.
- `SpreadsheetImport.pendingDeckName` persists an edited new-deck name for the
  in-transaction creation. Create mode ⇒ `ignoreRowIds=true` + `pendingDeckName`
  set; update mode ⇒ `deckId` set + `ignoreRowIds=false`.

## Data model

`SpreadsheetImport` gains:

- `batchId String?` (+ `@@index([batchId])`) — groups extracted spreadsheets;
  `null` for single-file imports.
- `pendingDeckName String?` — deferred new-deck name.

Migration: `20260606190029_zip_batch_spreadsheet_import`.

## Server

- `POST /api/decks/spreadsheet/import-archive` (user-scoped): validates `.zip`,
  streams to a temp file, calls `extractSpreadsheetArchive`, deletes the temp
  zip, returns `{ batchId, items }`.
- `extractSpreadsheetArchive` (`deckSpreadsheetService/archive.ts`): enumerates
  `.xlsx` entries (skips directories, dotfiles, `__MACOSX/`, non-`.xlsx`), caps
  at 100 entries and 20MB per entry, writes each to upload storage as its own
  `SpreadsheetImport` row sharing a fresh `batchId`, and inspects each one
  tolerantly (an unreadable Meta sheet marks that item failed without aborting
  the batch).
- `deckSpreadsheetService/batch.ts`: `getDeckSpreadsheetBatch`,
  `confirmDeckSpreadsheetImportBatch`, `runDeckSpreadsheetImportBatchJob`,
  `handleDeckSpreadsheetImportBatchWorkerJobError`.
- tRPC: `deckSpreadsheet.getBatch` (query) and `deckSpreadsheet.confirmBatch`
  (mutation).
- Existing storage cleanup sweeps `SpreadsheetImport` rows by age, so batch rows
  and their files are covered.

## Shared

`batchIdInput`, `confirmDeckImportBatchInput` (max 100 items, create-needs-name
superRefine), `DeckSpreadsheetBatchItem`, `DeckSpreadsheetBatchView`,
`DeckSpreadsheetArchiveUploadResult`.

## Client

- `DeckSpreadsheetImportPage`: accepts `.xlsx,.zip`; branches on `.zip` to the
  archive endpoint then navigates to the batch route.
- `DeckSpreadsheetBatchImportPage` + route `/(app)/imports/spreadsheet-batch`
  (search params `batchId`, optional `deckId`): polls `getBatch`, renders the
  per-file review/editing UI, runs `confirmBatch`, then polls to terminal state.

## QA

- `pnpm typecheck` — pass.
- `pnpm lint` (client) — pass (one pre-existing unrelated warning).
- `pnpm test` — pass; new `DeckSpreadsheetBatch.test.ts` covers extraction and
  junk-entry filtering, mixed create/update import, all-or-nothing rollback,
  duplicate new-deck-name rejection, empty-zip rejection, and per-user scoping.
- `pnpm test:e2e` — existing happy path must stay green (delete
  `packages/server/prisma/e2e.db` if sticky).
