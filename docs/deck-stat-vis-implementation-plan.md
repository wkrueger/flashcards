# Deck Stat Visualization Implementation Plan

## Goal

Replace the current Deck Detail top stat row with a compact horizontal subject-progress visualization described in `docs/deck-stat-vis.md`.

The visualization is subject-based: the full bar represents all subjects in the deck. The "due" boundary should use the same subject count currently used by the Review button (`wordCount - cooldownCount`), not card count. The footer below the bar still shows both totals: `X subjects, Y cards`.

Do not use card review stats for this feature. Card stats exist only to choose among multiple cards
within an already selected subject during review. Every marker, segment, and seen/unseen decision
in this visualization must come from `Subject` state. The only card value displayed here is the
plain total `cardCount` in the footer.

## Current State

- Deck Detail renders the top numbers in `packages/client/src/domains/decks/deck-detail.page/index.tsx` via `TopStat`.
- Deck metadata comes from `trpc.decks.get`, which already returns:
  - `cardCount`
  - `wordCount`
  - `cooldownCount`
- Upcoming due totals come from `trpc.decks.upcomingDueCounts`, which already returns cumulative subject counts for:
  - `in24h`
  - `in2d`
  - `in1w`
- Subject seen state already exists on `Subject` via `firstSeenAt`, `lastSeenAt`, and `timesSeen`.
  The requested first section is "subjects never seen", so the backend needs to expose a
  subject-level unseen count.

## Data Contract

Update `decks.get` to expose subject-level seen state:

```ts
seenSubjectCount: number
unseenSubjectCount: number
```

Definition:

- `seenSubjectCount`: count subjects in the requested deck and current user scope where
  `firstSeenAt` is not `null`.
- `unseenSubjectCount`: count subjects in the requested deck and current user scope where
  `firstSeenAt` is `null`.
- This should be subject-level, not card-level.
- Keep existing per-user scoping through `deckId` plus `userId`.
- Use `firstSeenAt` rather than `timesSeen` because inverse review marks a subject as seen by
  setting `firstSeenAt`/`lastSeenAt` without incrementing `timesSeen`.

Derived frontend values:

```ts
subjectCount = deck.wordCount
cardCount = deck.cardCount
unseenCount = deck.unseenSubjectCount
dueCount = deck.wordCount - deck.cooldownCount
dueIn24h = upcoming.in24h
dueIn48h = upcoming.in2d
```

All marker counts are cumulative from the left edge:

- `unseen`: `unseenCount`
- `due`: `dueCount`
- `24h`: `dueIn24h`
- `48h`: `dueIn48h`

Clamp all marker positions to `[0, subjectCount]` before computing percentages so inconsistent future data cannot break layout.

## Backend Work

1. Update `packages/server/src/domains/decks/decks.router.ts`.
2. In `decks.get`, replace the old card-based `cardsSeen` query with subject counts for
   `firstSeenAt: { not: null }` and `firstSeenAt: null`.
3. Return `seenSubjectCount` and `unseenSubjectCount` alongside the existing deck metadata.
4. Update `packages/server/tests/domains/decks.test.ts`.
5. Extend the existing `get returns deck metadata...` test or add a focused test that:
   - creates multiple subjects,
   - marks one subject as seen through `firstSeenAt`/`lastSeenAt`,
   - verifies `seenSubjectCount` and `unseenSubjectCount`,
   - keeps the existing card/word/cooldown assertions intact.

No Prisma migration is needed because subject seen fields already exist.

## Frontend Work

1. Add a new component under the existing domain folder:

```txt
packages/client/src/domains/decks/deck-detail.page/DeckSubjectStatsBar.tsx
```

2. Replace the current `<TopStat />` row in `deck-detail.page/index.tsx` with the new component.
3. Remove `TopStat` if it becomes unused.
4. Keep the existing `upcomingDueCounts` query because it already supplies cumulative `24h` and `48h` counts.
5. Pass only primitive counts into the component:

```tsx
<DeckSubjectStatsBar
  cardCount={deck.data.cardCount}
  subjectCount={deck.data.wordCount}
  unseenCount={deck.data.unseenSubjectCount}
  dueCount={dueCount}
  dueIn24h={upcoming.data?.in24h}
  dueIn48h={upcoming.data?.in2d}
/>
```

6. Handle loading `upcoming` values by hiding the `24h` and `48h` labels until counts are available, while still rendering the main bar from `deck.data`.

## Component Behavior

Use plain React, Tailwind, and small DOM measurement. Do not add a charting library for this.

Layout:

- Outer wrapper: full width, compact vertical spacing.
- Label layer above the bar.
- Thin segmented horizontal bar.
- Centered footer below: `X subjects, Y cards`.

Segments:

- Segment 1: `0 -> unseenCount`.
- Segment 2: `unseenCount -> dueCount`.
- Segment 3: `dueCount -> subjectCount`.
- If a segment width is `0`, render it with width `0` and no visual gap.
- Use restrained semantic colors compatible with the existing green-tinted theme:
  - unseen: muted foreground/background,
  - due: primary/destructive-leaning accent only if it does not clash,
  - remaining: muted/accent background.

Markers:

- Draw marker arrows at the cumulative positions for `unseen`, `due`, `24h`, and `48h`.
- Marker label format:

```txt
12
due
```

- Position labels with absolute positioning above the bar using `left: ${percent}%` and `transform: translateX(-50%)`.
- Position arrows just above or on the bar at the same percentage.
- Include `aria-label` or screen-reader text summarizing all counts because absolute marker labels can be hidden visually.

Zero-state:

- If `subjectCount === 0`, render an empty muted bar and footer `0 subjects, 0 cards`.
- Hide all markers in the zero-state.

Pluralization:

- Footer should use `subject`/`subjects` and `card`/`cards`.

## Label Collision Handling

Implement collision hiding inside `DeckSubjectStatsBar.tsx`.

Priority from the spec:

1. `due`
2. `unseen`
3. `24h`
4. `48h`

Interpretation: when labels overlap, keep higher-priority labels visible and hide lower-priority labels.

Implementation approach:

1. Render all candidate labels in an absolutely positioned label row.
2. Store refs for each label.
3. In a `useLayoutEffect`, measure each visible label with `getBoundingClientRect()`.
4. Sort candidates by priority.
5. Walk candidates in priority order:
   - keep the candidate if it does not overlap any already-kept label,
   - hide it if it overlaps a kept label.
6. Recalculate on:
   - count changes,
   - `ResizeObserver` updates for the wrapper.
7. If `ResizeObserver` is unavailable, fall back to one measurement pass after render and a `window.resize` listener.

Keep this logic local to the component unless it becomes reused elsewhere.

## Accessibility

- The visual bar can be `aria-hidden="true"` if a nearby screen-reader summary is provided.
- Add an `sr-only` summary such as:

```txt
Deck contains 24 subjects and 31 cards. 4 subjects are unseen, 7 are due now, 12 are due within 24 hours, and 16 are due within 48 hours.
```

- Do not rely on color alone; labels and the screen-reader summary carry the meaning.
- Ensure touch/mobile layout remains stable inside the existing `max-w-md` app shell.

## Testing

### TypeScript

Run:

```sh
pnpm typecheck
```

Expected: server router return type propagates to the client without type errors.

### ESLint

Run:

```sh
pnpm lint
```

Expected: no unused imports/vars, valid React hooks usage in the measurement effect.

### Vitest Integration Tests

Run:

```sh
pnpm test
```

Expected: updated `decks.get` test verifies subject-level seen/unseen counts, and existing domain tests remain green.

### Playwright E2E

Update `packages/client/e2e/happy-path.spec.ts` to assert that, after creating a card on Deck Detail:

- the old top stat row is no longer the target of assertions,
- the new footer text appears, for example `1 subject, 1 card`,
- the review button still says `Review 1 due`.

Run:

```sh
pnpm test:e2e
```

Expected: signup-to-review happy path remains green.

### Formatting

Run after code edits:

```sh
pnpm format
pnpm format:check
```

Expected: no Prettier drift.

## Manual QA

Check Deck Detail at mobile width and desktop width for these cases:

- Empty deck.
- One unseen and due subject.
- Multiple due subjects, with some unseen.
- No due subjects but subjects due within 24h and 48h.
- Dense labels where `unseen`, `due`, `24h`, and `48h` positions are close together.
- Dark mode and light mode.

Confirm:

- Labels do not overlap.
- Higher-priority labels remain visible when collisions happen.
- Bar segments do not shift the surrounding layout.
- Footer is centered and readable.
- Review and free-review buttons still behave as before.

## Implementation Order

1. Backend: replace card-based `cardsSeen` with subject-level seen/unseen counts in `decks.get`.
2. Server tests: cover the new count.
3. Frontend: create `DeckSubjectStatsBar`.
4. Frontend integration: replace the old `TopStat` row in Deck Detail.
5. E2E: assert the new footer and preserve the review flow.
6. Run `pnpm format`.
7. Run quality gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm format:check`.
