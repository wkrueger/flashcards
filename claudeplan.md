# Vocabulary Flashcards App — Initial Build Plan

## Context

Greenfield mobile-first web app for vocabulary learning via spaced-repetition flashcards. The user wants Stage 1 only (core CRUD + review loop). Stage 2 (AI generation) is deferred. Multi-user with email+password auth so decks/cards are scoped per user. Stack chosen: pnpm monorepo, Fastify + tRPC + Prisma + SQLite backend, Vite + TanStack Router + TanStack Query + shadcn frontend, better-auth for sessions.

## Repository Layout

```
cards/
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env                      # DATABASE_URL, BETTER_AUTH_SECRET
├── packages/
│   ├── shared/                      # cross-cutting types/schemas only
│   │   └── src/
│   │       ├── index.ts
│   │       └── fixation.ts          # FixationLevel string union + cooldown map
│   ├── server/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── seed.ts              # seeds Languages: 🇬🇧 English, 🇩🇪 Deutsch
│   │   │   └── migrations/
│   │   ├── tests/
│   │   │   ├── setup.ts             # per-worker SQLite + migrate
│   │   │   └── domains/
│   │   │       ├── decks.test.ts
│   │   │       ├── cards.test.ts
│   │   │       └── review.test.ts
│   │   └── src/
│   │       ├── main.ts              # Fastify bootstrap
│   │       ├── infra/
│   │       │   ├── db.ts            # PrismaClient singleton
│   │       │   ├── auth.ts          # better-auth instance + Fastify mount
│   │       │   └── trpc.ts          # init, context (db, session), procedures
│   │       └── domains/
│   │           ├── languages/
│   │           │   └── languages.router.ts
│   │           ├── decks/
│   │           │   ├── decks.router.ts
│   │           │   └── decks.service.ts
│   │           ├── subjects/
│   │           │   ├── subjects.router.ts
│   │           │   └── subjects.service.ts   # upsert by (userId, text)
│   │           ├── cards/
│   │           │   ├── cards.router.ts
│   │           │   ├── cards.service.ts      # frontHash, unique violation mapping
│   │           │   └── cards.schema.ts       # zod
│   │           ├── review/
│   │           │   ├── review.router.ts
│   │           │   ├── review.service.ts     # pickup (normal + free), complete
│   │           │   └── review.schema.ts
│   │           └── _app.router.ts            # merges domain routers
│   └── client/
│       ├── index.html
│       ├── vite.config.ts
│       ├── e2e/
│       │   └── happy-path.spec.ts
│       └── src/
│           ├── main.tsx
│           ├── router.tsx
│           ├── infra/
│           │   ├── trpc.ts             # tRPC + React Query client
│           │   ├── auth-client.ts      # better-auth/client
│           │   └── theme.tsx           # dark/light toggle
│           ├── ui/                     # shadcn-generated primitives
│           ├── components/             # AppShell, MarkdownView (shared)
│           ├── domains/
│           │   ├── auth/
│           │   │   ├── login.page.tsx
│           │   │   └── signup.page.tsx
│           │   ├── decks/
│           │   │   ├── deck-list.page.tsx
│           │   │   └── deck-detail.page.tsx
│           │   ├── cards/
│           │   │   ├── card-form.tsx           # shared create/edit form
│           │   │   ├── card-new.page.tsx
│           │   │   ├── card-edit.page.tsx
│           │   │   └── subject-autocomplete.tsx
│           │   └── review/
│           │       ├── review.page.tsx         # supports ?mode=free
│           │       ├── reveal-card.tsx
│           │       └── cooldown-buttons.tsx
│           └── routes/                          # thin file-based route shells
│               ├── __root.tsx                   # max-width wrapper, theme + auth gate
│               ├── login.tsx
│               ├── signup.tsx
│               ├── index.tsx                    # → deck-list.page
│               ├── decks.$deckId.tsx            # → deck-detail.page
│               ├── decks.$deckId.review.tsx     # → review.page (mode=normal)
│               ├── decks.$deckId.review.free.tsx# → review.page (mode=free)
│               ├── decks.$deckId.cards.new.tsx
│               └── decks.$deckId.cards.$cardId.edit.tsx
```

## Data Model (Prisma)

```prisma
model User {
  id        String   @id
  email     String   @unique
  // better-auth fields...
  decks     Deck[]
  subjects  Subject[]
}

model Language {
  id    Int    @id @default(autoincrement())
  name  String @unique
  emoji String
}

model Deck {
  id        String   @id @default(cuid())
  name      String
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cards     Card[]
  createdAt DateTime @default(now())
  @@unique([userId, name])
}

model Subject {
  id            String    @id @default(cuid())
  subject       String
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastSeenAt    DateTime?
  timesSeen     Int       @default(0)
  fixationLevel String    @default("1")      // "1".."5" (string to allow future levels like "0", "6", "new")
  cooldownAt    DateTime  @default(now())    // next eligible time
  cards         Card[]
  @@unique([userId, subject])
  @@index([userId, cooldownAt])
}

model Card {
  id          String    @id @default(cuid())
  deckId      String
  deck        Deck      @relation(fields: [deckId], references: [id], onDelete: Cascade)
  subjectId   String
  subject     Subject   @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  front       String
  frontHash   String                                // sha256 of front
  back        String
  lastSeenAt  DateTime?
  timesSeen   Int       @default(0)
  createdAt   DateTime  @default(now())
  @@unique([subjectId, frontHash])
  @@index([subjectId, lastSeenAt])
}
```

Fixation → cooldown map (server constant in `shared/fixation.ts`):
`{ "1": 2min, "2": 10min, "3": 12h, "4": 2d, "5": 1w }`. Levels are strings to keep the door open for future levels (e.g. `"new"`, `"0"`, `"6"`) without a migration on stored values. Validation uses `z.enum(["1","2","3","4","5"])` at the API edge today; widening later means extending the enum, not changing column types.

## Pickup Algorithm (`review.next`)

Two modes — selected by the caller via `mode: "normal" | "free"`.

**Normal mode:**

1. Filter subjects for user where `cooldownAt <= now()` (and `deckId` if a deck is scoped via the card relation).
2. Take the oldest 30% by `cooldownAt` (`Math.max(1, ceil(count * 0.3))`).
3. Random-pick one subject.
4. Within it, return the card with the oldest `lastSeenAt` (nulls first).
5. Returns `{ card: null, dueCount: 0 }` if no subject is due — the client uses `dueCount === 0` to surface the "Free review" entry point.

**Free mode:**

1. Same algorithm, but **omit** the `cooldownAt <= now()` filter — every subject is eligible regardless of cooldown.
2. Otherwise identical: oldest 30% by `cooldownAt`, random subject, oldest-`lastSeenAt` card.
3. Returns `null` only when the user genuinely has no cards (empty state).

Both modes share one `review.service.ts` helper that takes a `{ includeOnCooldown: boolean }` flag.

## Mutation: `review.complete({ cardId, chosenLevel })`

- Update `card.lastSeenAt=now`, `timesSeen+=1`.
- Update subject `lastSeenAt`, `timesSeen+=1`, `fixationLevel=chosenLevel`, `cooldownAt = now + cooldownFor(chosenLevel)`.
- Single Prisma `$transaction`.

## tRPC Routers (auth-protected via context except auth itself)

- `languages.list`
- `decks.list / create / rename / delete`
- `subjects.autocomplete({ query })` — startsWith, limit 10, scoped to user
- `cards.create({ deckId, subjectText, front, back })` — upsert subject by `(userId, subjectText)`, compute `frontHash = sha256(front)`, insert card; surface unique-violation as a typed error.
- `cards.update({ id, front?, back?, subjectText? })`
- `cards.delete / get / listByDeck`
- `review.next({ deckId?, mode: "normal" | "free" })` — returns `{ card, dueCount }`
- `review.complete({ cardId, chosenLevel })` — `chosenLevel` is a string `"1".."5"`; cooldown advances even in free mode (a free-review answer still updates stats)

## Frontend Behavior

- Root layout wraps content in `max-w-md mx-auto` for the mobile-narrow constraint on desktop.
- Auth gate in `__root.tsx`: redirect to `/login` if no session; otherwise render shell with deck list nav + theme toggle.
- **Review screen** (one component, both modes via route param): front rendered as markdown (react-markdown). "Reveal" button toggles back. After reveal, show 4 cooldown buttons — `"2".."5"` if previous fixation was `"4"` or `"5"`, else `"1".."4"`. Each button label = human cooldown ("2 min", "10 min", "12h", "2 days", "1 week"). On click → mutation → fetch next card.
- **No-cards-due state (normal mode)**: when `review.next` returns `{ card: null, dueCount: 0 }`, render an empty state with two buttons: "Back to deck" and "Free review" → navigates to `/decks/$deckId/review/free`. The deck-detail page also shows the "Free review" button whenever `dueCount === 0` for that deck.
- **Free review screen**: same component, badge in the header reading "Free review" so the user knows cooldowns are being ignored. Cooldown buttons behave identically.
- Floating "Edit" button on the card navigates to the card edit route in both modes.
- **Card editor**: plain `<Textarea>` for front/back (no markdown toolbar). Subject field is a free-typed input with a popover listing autocomplete results from `subjects.autocomplete`; submitting any string is allowed.
- Dark mode: shadcn standard `next-themes`-style provider, toggle in header.

## Key Libraries

- `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`
- `@tanstack/react-router` (file-based routes via `@tanstack/router-plugin`)
- `prisma`, `@prisma/client`
- `fastify`, `@fastify/cors`, `fastify-plugin`, `@trpc/server/adapters/fastify`
- `better-auth` (server + `better-auth/client` for the SPA; mounted as Fastify routes)
- `zod`, `react-markdown`, `tailwindcss`, `class-variance-authority`, `lucide-react`
- shadcn components: button, input, textarea, card, dialog, popover, command, dropdown-menu, label, sonner

## Files To Create (new repo, no existing code to reuse)

All files listed in the layout above. No prior code to integrate against.

## Tooling: Typecheck, Lint, Tests

**TypeScript** — strict mode in `tsconfig.base.json`. Each package has its own `tsconfig.json` extending the base. Root script `pnpm typecheck` runs `tsc --noEmit` across all packages.

**ESLint (frontend only)** — `packages/client/.eslintrc.cjs` with a minimal config:

- `@typescript-eslint/no-unused-vars` (error, with `argsIgnorePattern: "^_"`)
- `eslint-plugin-react` recommended rules
- `eslint-plugin-react-hooks` (rules-of-hooks + exhaustive-deps)
- No stylistic, import-order, or other opinionated rules. Server/shared packages have no ESLint config.

**Integration tests (server)** — `packages/server/tests/*.test.ts` using `vitest`. Each test file uses a fresh SQLite file (`file:./test-${pid}.db`) created via `prisma migrate deploy`, torn down after. Tests call tRPC routers directly via `appRouter.createCaller(ctx)` with a stubbed authenticated context.
Coverage:

- `cards.create` enforces unique `(subject, frontHash)` and transparently creates subjects.
- `review.next({ mode: "normal" })` returns `{ card: null, dueCount: 0 }` when nothing due; with seeded subjects of varied `cooldownAt`, only the oldest-30%-of-due can be returned (run 100 iterations, assert membership).
- `review.next({ mode: "free" })` returns a card even when every subject is on cooldown; still respects oldest-30%-by-cooldownAt selection across the full set.
- `review.complete` updates fixation level, advances `cooldownAt` per the fixation map, and bumps `timesSeen` on both card and subject in one transaction.
- `decks` and `subjects` enforce per-user scoping (user A cannot read user B's data).

**E2E tests** — Playwright in `packages/client/e2e/`. `playwright.config.ts` uses a `webServer` block that spawns `pnpm dev` (server + client) against an isolated test DB. Single happy-path spec mirroring the verification flow: signup → create deck → add 2 cards (same subject) → review one → choose level 3 → assert next-card cooldown buttons show `2..5` → edit card → logout.

**Root scripts** (`package.json`):

- `pnpm dev` — concurrently runs server + client
- `pnpm typecheck` — all packages
- `pnpm lint` — frontend only
- `pnpm test` — vitest (server)
- `pnpm test:e2e` — playwright

## Build Order

1. Workspace scaffolding (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, root scripts, `.env.example`).
2. `packages/shared` — fixation map, zod schemas.
3. `packages/server` — Prisma schema + initial migration + Language seed; Fastify + tRPC bootstrap; better-auth wiring; routers in dependency order (languages → decks → subjects → cards → review); vitest config + integration tests.
4. `packages/client` — Vite + Tailwind + shadcn init; ESLint config; TanStack Router + Query + tRPC client; auth pages; deck list; card list/create/edit; review flow; dark-mode toggle; Playwright config + happy-path spec.
5. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`, then smoke-test in a browser.

## Verification

- `pnpm typecheck` passes across all packages.
- `pnpm lint` (frontend) passes with only the rules listed above.
- `pnpm test` (server vitest integration) passes.
- `pnpm test:e2e` (Playwright happy path) passes.
- `pnpm --filter server prisma migrate dev` creates the SQLite DB and seeds 🇬🇧/🇩🇪 languages.
- `pnpm dev` runs server (Fastify on `:3001`) and client (Vite on `:5173`) concurrently.
- Manual flow in browser at mobile viewport (Chrome devtools, 390px):
  1. Sign up → redirected to deck list (empty).
  2. Create deck "German A1".
  3. Add 3 cards under subjects "Haus", "Haus" (second card same subject), "Buch" — verify only 2 subjects exist; verify duplicate `(subject, front)` is rejected.
  4. Open review → reveal → choose level "3" → next card appears; verify subject's `cooldownAt` advanced 12h. Choose level "4" on the next card; verify the subsequent prompt for that subject shows `"2".."5"` buttons.
     4b. After all due cards are answered, the review screen shows the empty state with a "Free review" button; clicking it lands on `/decks/$deckId/review/free` and serves a card whose subject is still on cooldown.
  5. Edit a card from review screen, save, return to review.
  6. Toggle dark mode persists across reload.
  7. Log out → `/login` enforced.
- Spot-check pickup: with 10 subjects all due, repeat `review.next` ~30 times and confirm only the oldest-cooldown ~30% appear.
