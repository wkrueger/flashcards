# Sequential decks — design

## Summary

Add a per-deck "Sequential deck" option. When enabled, the deck is studied in a
fixed order (subjects, then cards within each subject) instead of the
spaced-repetition pickup. The reviewer walks the whole ordered sequence, shows
"Next" on every card except the last card of a subject (which keeps the normal
fixation buttons), and gains Prev / Restart controls. Card and subject order is
editable in the subject-detail page (up/down) and via XLS import/export.

By default `sequentialEnabled` is false and nothing changes.

## Decisions (locked during brainstorming)

- **Options submenu**: a new "Options" item below "Edit deck" in the deck-detail
  popover, inline-expanding within the popover (no native submenu). Holds the
  Sequential deck checkbox. Speech/Inverse toggles stay at page bottom.
- **Cooldowns**: fixation buttons write cooldown/fixation/stats exactly as today.
  The sequential picker _ignores_ cooldown when choosing the next card — it always
  walks the full sequence. Because cooldowns are still written, stats keep working
  and switching back to non-sequential mode behaves normally.
- **Restart**: pure navigation to the first card. Writes nothing.
- **Deck-detail entry**: sequential decks show a single "Review" button (no
  due/free split). Non-sequential decks unchanged.
- **No inverse review** in the sequential branch.
- **Global ordering flip accepted**: `subjects.get` cards change from `createdAt
desc` to `(order, createdAt) asc`. Minor visual change to non-sequential subject
  pages — accepted.

## Schema (`packages/server/prisma/schema.prisma`)

- `Deck.sequentialEnabled  Boolean @default(false)`
- `Subject.order  Int?` (default null)
- `Card.order  Int?` (default null)

Migration: `pnpm db:migrate`.

## Ordering rule (global)

Everywhere subjects/cards are listed:
`orderBy: [{ order: "asc", nulls: "last" }, { createdAt: "asc" }]`.

Non-sequential decks have all-null order → pure `createdAt asc`. Non-null orders
sort before the null block; within either block `createdAt` breaks ties.

## Deck flag plumbing (`shared`, `decks` domain)

- `createDeckInput` / `updateDeckInput`: add `sequentialEnabled: z.boolean().optional()`.
- `decks.get` returns `sequentialEnabled`.
- `decks.update` persists it (add to the conditional `data` build).

## Options submenu (deck detail — `deck-detail.page/index.tsx`)

- New "Options" `MenuItem` rendered directly below "Edit deck". Clicking it
  toggles an inline expanded section inside the popover (chevron indicator) that
  contains the **Sequential deck** checkbox.
- Toggle writes via `decks.update`, optimistic (same pattern as the existing
  `updateReviewSettings` mutation), invalidating `decks.get` and `review.next`.

## Sequential review — server (`review` domain)

New procedure `review.sequential({ deckId, cardId?, move })`,
`move ∈ "resume" | "next" | "prev" | "first"`.

Approach: **punctual queries** (no whole-deck scan). Sequence is subjects by
`(order asc nulls last, createdAt asc)`, cards within a subject by the same.

- **Load current**: the card (+ subjectId) and the current subject's card ids in
  order → within-subject index, `isLastInSubject`, within-subject prev/next.
- **Cross-subject boundary**: fetch the single adjacent subject via a cursor
  `take:1` helper `findAdjacentSubject(prisma, userId, deckId, current, direction)`,
  then its first card (next) or last card (prev). The helper handles the null
  boundary explicitly:
  - next, current.order != null → smallest tuple `(order > o) OR (order = o AND
createdAt > c)`; if none, first null-order subject by `createdAt`.
  - next, current.order == null → next null-order subject with `createdAt >` (min).
  - prev, current.order == null → prev null-order subject with `createdAt <` (max);
    if none, last non-null subject.
  - prev, current.order != null → largest non-null tuple strictly less.
- `resume` → card with max `lastSeenAt` in deck (`take:1`, `lastSeenAt not null`);
  fallback to first card.
- `first` → first subject (cursor `take:1`) → its first card.
- `next` past the final card → `{ card: null, atEnd: true }`.

Returns `{ card, isLastInSubject, hasPrev, atEnd }`. `card` payload mirrors the
existing review card shape (subject fields + tags), no inverse fields.

New mutation `review.advance({ cardId })` — the "Next" on non-last cards: sets
`card.lastSeenAt = now` only. No fixation, no cooldown, no streak, no review-stat
writes (mirrors the inverse path's "no stats" behavior). Keeps the resume pointer
correct.

The **last card of a subject** uses the existing `review.complete` (chosenLevel)
unchanged → cooldown / fixation / stats as today.

## Sequential review — client (`review.page.tsx`)

`ReviewPage` branches on `deck.sequentialEnabled`:

- Uses `review.sequential` instead of `review.next`; tracks the current `cardId`
  in component state. No inverse logic in this branch.
- Entry move = `"resume"`.
- Reveal:
  - `isLastInSubject` → fixation buttons → `review.complete({ chosenLevel })` then
    advance (`move:"next"`).
  - else → **Next** button → `review.advance({ cardId })` then advance.
- Header actions (sequential only), in order: **Prev** (`move:"prev"`, no writes),
  **Restart** (confirmation dialog → `move:"first"`, no writes), then the existing
  **Edit card** action.
- `atEnd` (or no card) → completion state ("Reached the end" → back to deck /
  Restart).

## Deck-detail entry button

Sequential deck → single **Review** button → `/decks/$deckId/review`. The due
counts / stats bar above stays. Non-sequential decks keep the existing due/free
split.

## Subject detail reorder (`subject-cards.page.tsx`)

- Show **up** / **down** icon buttons before the existing trash button, only when
  `deck.sequentialEnabled`.
- New mutation `subjects.reorderCard({ cardId, direction: "up" | "down" })`: load
  the subject's cards ordered, swap the target with its neighbor, then persist
  `order = index` for every card in the subject (materializes null → ints,
  idempotent).
- Disable up on the first card, down on the last.

## XLS import / export (`deck-spreadsheet` domain)

- `workbook.ts`: extend `CARD_HEADERS` with `subjectOrder` and `cardOrder`. Parse
  into `SpreadsheetRow.subjectOrder` / `cardOrder` (blank cell → null, else int).
- **Export** (`service/index.ts`): write `subject.order` and `card.order` (null →
  blank). Change the export card query order to `(order, createdAt) asc` so the
  file is emitted in sequence.
- **Import** (`service/import-rows.ts`): set `card.order` per row. For subjects,
  **first appearance wins** — keep a `Map<subjectKey, order|null>` populated by the
  first row that mentions each subject; apply that order to the subject on create
  and update. (Existing subjects get their order updated from the import.)

## QA (first-class deliverables)

- **Vitest** (`packages/server/tests`):
  - Ordering: null vs createdAt fallback; mixed null/non-null.
  - `review.sequential`: resume / next / prev / first / atEnd, cross-subject
    boundaries, null-order boundaries.
  - `review.advance`: updates only `lastSeenAt`; no cooldown/fixation/stats.
  - `subjects.reorderCard`: swap + materialization, bounds.
  - XLS round-trip: order columns export+import; first-appearance-wins on
    conflicting subject orders.
  - Per-user scoping on the new procedures/mutations.
- **Playwright** (`e2e/happy-path.spec.ts` or new spec): enable sequential, walk a
  subject (Next → fixation on last card), Prev, Restart confirmation.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`.

## Out of scope

- UI to reorder _subjects_ (only via correct insertion order or XLS import).
- Reordering across subjects in the subject-detail page.
