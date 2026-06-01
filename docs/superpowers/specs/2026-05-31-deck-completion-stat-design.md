# Deck completion statistic — design

## Goal

Show a deck's completion percentage in the deck-detail page, appended to the existing
"`N subjects, M cards`" line as "`, 90%`". Percentage reflects how well the deck's subjects
are memorized, derived from each subject's latest selected fixation level.

## Scoring

Per subject, add points to the deck's **completion score** based on its current
`Subject.fixationLevel` (the latest selected fixation):

| Fixation | Points |
| -------- | ------ |
| 1        | 0      |
| 2        | 0      |
| 3        | 0.25   |
| 4        | 0.5    |
| 5        | 0.75   |
| 6        | 1      |

- **completionScore** ∈ `[0, subjectCount]` = Σ points over the deck's subjects.
- **completion %** = `completionScore / subjectCount` → reaches 100% when every subject is at
  fixation 6.
- A new/unseen subject defaults to fixation `"1"` = 0 points, so adding subjects correctly
  lowers the percentage without any explicit bookkeeping (score unchanged, denominator grows).

## Data model

Add to `Deck` (Prisma):

```prisma
completionScore     Float?     // null = unknown/stale, needs recompute. 0..subjectCount
completionComputedAt DateTime? // when completionScore was last fully recomputed
```

Both **nullable, default null**. `null` ⇒ never computed or invalidated ⇒ UI hides the percent
and the next read recomputes. No migration backfill script — existing decks are simply `null`
until first read recompute.

## Behavior

### Display

`DeckSubjectStatsBar.tsx:266` renders `"{subjectCount} subjects, {cardCount} cards"`. Append
`, {percent}%` **only when** the percent is non-null. `deck.get` returns a new
`completionPercent: number | null` field:

- `completionScore == null` → `completionPercent = null` (hidden).
- `subjectCount === 0` → `null` (avoid 0/0; nothing to complete).
- else → `Math.round((completionScore / subjectCount) * 100)`.

### Recompute (single source of truth)

`recomputeDeckCompletion(prisma, deckId, now)` in `review.service.ts`:

1. One `prisma.subject.groupBy({ by: ['fixationLevel'], where: { deckId }, _count: true })`.
2. Sum `points(level) * count` in JS using `COMPLETION_POINTS` (see below).
3. `deck.update` → `completionScore = sum`, `completionComputedAt = now`.

Returns the new score. One query regardless of subject count.

### Lazy-on-read staleness (periodic refresh)

In `decks.get`: after loading the deck, if `completionScore == null` **or**
`completionComputedAt` is null/older than 24h, call `recomputeDeckCompletion` and use the fresh
value for the response. This is the "daily full recompute" — it only touches decks actually
viewed, needs no background timer, and doubles as the null-backfill.

### Incremental update on review

In `completeReview` (the non-inverse branch, inside the existing `$transaction`):

- If `deck.completionScore == null` → call `recomputeDeckCompletion` (self-heal; uses the
  post-update levels, so do it after the subject's `fixationLevel` is written, or include the
  delta).
- Else → apply `delta = COMPLETION_POINTS[chosenLevel] - COMPLETION_POINTS[previousLevel]` and
  `deck.update({ completionScore: { increment: delta } })`. `previousLevel` = the subject's
  `fixationLevel` before this review (`card.subject.fixationLevel`, already loaded).

The **inverse** review branch does not change `fixationLevel`, so it makes no score change.

To read `completionScore == null` we need it loaded — `completeReview` already fetches the card
with `include: { subject: true }`; add a deck `completionScore` read (or fetch in the
transaction). Keep it inside the same `$transaction` as the subject update for consistency.

### Drift invalidation (set null on drift paths)

Incremental deltas only track the review path. Any path that **removes a subject** (or could
desync membership) sets `completionScore = null, completionComputedAt = null` for the affected
deck — lazy read then recomputes exactly. A shared helper:

```ts
// review.service.ts (or subjects.service.ts)
function markDeckCompletionStale(prisma, deckId): mark completionScore & completionComputedAt null
```

Call sites (drift sources found in the codebase):

- `subjects/subjects.service.ts:49` `deleteEmptySubjectsForDeck` — covers review-path cleanup
  (`review.service.ts:203`) and any other caller.
- `subjects/subjects.router.ts:95` single subject delete.
- `cards/cards.router.ts:164` card delete (may empty + delete its subject).
- `deck-spreadsheet/.../import-rows.ts:39,136` card/subject deletes during spreadsheet sync —
  simplest: mark the deck stale once when a spreadsheet import finishes.
- Anki import creates a **new** deck (default `null`) → no action needed.

Adds-only paths (new subjects, new cards into existing subjects) are correct without
invalidation, so card/subject **create** is left untouched — but marking stale there is
harmless if simpler.

## Constants

Add to `packages/shared/src/fixation.ts`, beside `COOLDOWN_MS`:

```ts
export const COMPLETION_POINTS: Record<FixationLevel, number> = {
  "1": 0,
  "2": 0,
  "3": 0.25,
  "4": 0.5,
  "5": 0.75,
  "6": 1,
}
```

## Out of scope

- No debounce / batched stat writer (explicitly dropped).
- No background timer / cron.
- `ReviewStat` (cardMinutes/cardCount) logic is unchanged.

## QA / verification (must stay green)

- **Prisma migration** for the two new nullable `Deck` columns (`pnpm db:migrate`).
- **Typecheck** `pnpm typecheck`.
- **Lint** `pnpm lint` (client only).
- **Vitest integration** (`packages/server/tests/domains/`):
  - points mapping & `recomputeDeckCompletion` sum (mixed levels).
  - incremental delta on review (level up and level down) matches recompute.
  - `completeReview` with `completionScore == null` triggers full recompute.
  - drift paths (subject delete, card delete emptying subject, spreadsheet import) null the score.
  - lazy-on-read: stale/null `deck.get` recomputes and returns fresh `completionPercent`.
  - `subjectCount === 0` and `null` score → `completionPercent === null`.
  - per-user scoping preserved.
- **Playwright e2e**: extend happy path to assert the percent appears on the deck-detail line
  after a review.
- **Prettier** `pnpm format`.
