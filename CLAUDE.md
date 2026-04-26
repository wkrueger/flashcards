# Claude project notes — Cards

Mobile-first vocabulary flashcards app with spaced-repetition cooldowns. Multi-user (email + password). Greenfield project, see `initspec.md` for the original brief and `README.md` for user-facing setup.

## Stack

- **Monorepo**: pnpm workspaces. Three packages: `shared`, `server`, `client`.
- **Backend**: Fastify (`:3001`) + tRPC + Prisma + SQLite. Auth via `better-auth` (email + password, sessions in cookies, mounted under `/api/auth/*`).
- **Frontend**: Vite (`:5173`) + React 18 + TanStack Router (file-based) + TanStack Query + tRPC React Query client + shadcn-style UI primitives + Tailwind v3.
- **Tests**: Vitest (server integration, calls tRPC routers via `appRouter.createCaller`) + Playwright (single happy-path e2e).
- **Tooling**: TypeScript strict; ESLint **client-only** with a minimal config (only `@typescript-eslint/no-unused-vars`, `eslint-plugin-react`, `eslint-plugin-react-hooks` — see `feedback_frontend_eslint_minimal` memory); Prettier whole-repo (printWidth 100, no semicolons — see `feedback_prettier` memory).

## Layout

```
packages/
├── shared/                          # cross-cutting only — zod schemas, fixation cooldowns
│   └── src/{fixation.ts, schemas.ts, index.ts}
├── server/
│   ├── prisma/{schema.prisma, seed.ts, migrations/, dev.db}
│   ├── src/
│   │   ├── main.ts                  # Fastify bootstrap, /api/auth/* + /trpc + /health
│   │   ├── infra/{db.ts, auth.ts, trpc.ts}
│   │   ├── domains/                 # GROUPED BY DOMAIN, not by layer
│   │   │   ├── languages/languages.router.ts
│   │   │   ├── decks/decks.router.ts
│   │   │   ├── subjects/{subjects.router.ts, subjects.service.ts}
│   │   │   ├── cards/{cards.router.ts, cards.service.ts}
│   │   │   ├── review/{review.router.ts, review.service.ts}
│   │   │   └── _app.router.ts       # merges domain routers; exports AppRouter type
│   │   └── generated/prisma/        # Prisma client output (gitignored)
│   └── tests/{setup.ts, helpers.ts, domains/*.test.ts}
└── client/
    ├── public/                      # favicon.svg + PWA icons + manifest.webmanifest
    ├── src/
    │   ├── main.tsx, routeTree.gen.ts (auto), styles.css
    │   ├── infra/{trpc.ts, auth-client.ts, theme.tsx}
    │   ├── ui/                      # shadcn primitives (button, input, card, etc.)
    │   ├── components/              # cross-domain (AppShell, MarkdownView)
    │   ├── domains/                 # auth, decks, cards, review — pages + sub-components
    │   └── routes/                  # thin file-based route shells → import domain pages
    └── e2e/happy-path.spec.ts
```

**Convention: group source by business domain, not by technical layer** (memory: `feedback_group_by_domain`). Routers, services, schemas, pages all live next to their domain folder.

## Domain rules

- **Fixation level** is a **string** ("1".."5") on `Subject.fixationLevel`, deliberately, so future levels can be added without a column-type migration. Validation uses `z.enum(["1","2","3","4","5"])` at the API edge. Cooldowns: 1=2min, 2=10min, 3=12h, 4=2d, 5=1w. Constants and helpers in `packages/shared/src/fixation.ts` (`COOLDOWN_MS`, `COOLDOWN_LABEL`, `FIXATION_EMOJI`, `nextCooldownAt`, `buttonsForPrevious`).
- **Pickup algorithm** (`pickNextCard` in `review.service.ts`):
  1. Filter user's subjects by `cooldownAt <= now()` (normal mode) OR all subjects (free mode), optionally constrained to a deckId via `cards: { some: { deckId } }`.
  2. Take the oldest 30% by `cooldownAt`: `Math.max(1, ceil(count * 0.3))`.
  3. Random pick from that slice.
  4. Within the chosen subject, the card with the oldest `lastSeenAt` (nulls first).
  5. Return `{ card, dueCount }`. Normal mode → `dueCount = candidates.length`; free mode runs an extra count of due-only subjects so the UI can hint when nothing is technically due.
- **Two review modes**: `normal` (only due) and `free` (ignore cooldown). When normal returns no card, the UI shows an empty state offering free review. Even in free mode, `review.complete` updates stats and resets cooldown.
- **Cooldown buttons after reveal** (4 buttons): if the previous fixation was "4" or "5", show `2..5`; otherwise `1..4`. Colored red→green, with face emojis (1😖 2😕 3🙂 4😀 5😎) — see `LEVEL_COLOR` and `FIXATION_EMOJI` in `review.page.tsx`.
- **Subjects are upserted by `(userId, subjectText)`** transparently when a card is created — no separate subject UI. Autocomplete via `subjects.autocomplete` (startsWith).
- **Card uniqueness**: `(subjectId, frontHash)` where `frontHash = sha256(front)`. Surfaced as tRPC `CONFLICT`.
- **Per-user scoping** is enforced in every router by filtering on `userId` (or via deck/card → deck → user joins). Tests cover this.
- **Languages** are admin-only (no UI). Seeded with English 🇬🇧 and Deutsch 🇩🇪. Add new ones by editing the SQLite `Language` table directly.

## Frontend specifics

- Mobile-first; whole app constrained to `max-w-md` in `AppShell`.
- Auth gate is in `routes/__root.tsx` (`beforeLoad` checks `authClient.getSession()`, redirects to `/login` if missing). Public routes are `/login` and `/signup`.
- **Nested routes need an `Outlet`**: `decks.$deckId.tsx` and `decks.$deckId.review.tsx` are layout files (just `<Outlet />`); the actual deck-detail and review-normal pages live in `decks.$deckId.index.tsx` and `decks.$deckId.review.index.tsx`. Without the layout split, child routes (e.g. `cards/new`) wouldn't render.
- **Don't wrap TanStack `<Link>` in `<Button asChild>` via Radix Slot** — the click handler gets lost. Use `buttonVariants(...)` className on `<Link>` instead. The deck-detail and review pages already use this pattern.
- **Cancel/back buttons** in card create/edit use `router.history.back()` (with a fallback to `/decks/$deckId`) so they preserve navigation context. The review-page back button explicitly returns to deck-detail (review pushes new state on each card; history.back would reopen the previous card).
- **Theme**: green-tinted palette in `styles.css` via shadcn-style HSL CSS vars; dark/light toggle in `infra/theme.tsx` via `next-themes`-style provider on `html.dark`. Tailwind config defines `borderColor.DEFAULT: hsl(var(--border))` so bare `border` utilities don't fall back to currentColor.
- **Markdown rendering**: `MarkdownView` uses `react-markdown` with `prose-lg`, custom `<p>` (text-lg) and `<strong>` (bold + underlined, primary color).
- **Cross-package type import**: client imports `AppRouter` via `import type { AppRouter } from "server/router"`. The `server` package exposes this via its `exports` field (`./router` → `src/domains/_app.router.ts`).

## Server specifics

- **Prisma client output is custom**: `generator client { output = "../src/generated/prisma" }` (avoids pnpm's `.prisma/client` resolution issues). Always import from `"../generated/prisma/client.js"` (relative `.js` extension required because tsconfig uses `NodeNext` module).
- **`.env` lives in `packages/server/.env`** (not just root) because Prisma CLI loads it from the package cwd. Server runtime also needs it: `pnpm dev` runs `tsx watch --env-file=.env src/main.ts`.
- **Tests** use a per-pid SQLite file in `packages/server/.test-db/` with `prisma migrate deploy` in `beforeAll`. Vitest is configured `singleFork: true, fileParallelism: false` so tests share one DB safely. `helpers.ts` exposes `makeUser`, `callerFor(userId)`, `resetDomain` (truncates Card → Subject → Deck → User between tests).
- **better-auth Fastify mount** is a manual catch-all route (`/api/auth/*`) that bridges Fastify req/res to the WHATWG `Request`/`Response` better-auth handler expects. See `main.ts` if you need to debug auth requests.

## Commands

Run from repo root unless noted.

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `pnpm install`      | Install workspace deps                                         |
| `pnpm dev`          | server (`:3001`) + client (`:5173`) concurrently               |
| `pnpm typecheck`    | `tsc --noEmit` across all packages                             |
| `pnpm lint`         | ESLint, client only                                            |
| `pnpm test`         | Vitest server integration tests                                |
| `pnpm test:e2e`     | Playwright happy path (signup → review → free review → logout) |
| `pnpm format`       | Prettier write whole repo                                      |
| `pnpm format:check` | Prettier check                                                 |
| `pnpm db:migrate`   | `prisma migrate dev` in server                                 |
| `pnpm db:seed`      | seed languages                                                 |

After editing `prisma/schema.prisma`, run `pnpm db:migrate`. After editing `routes/`, the TanStack router plugin regenerates `routeTree.gen.ts` on the next vite dev/build (or run `pnpm --filter client build`).

## Quality gates that must stay green

`pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` — that's the full suite. The e2e test rebuilds an isolated DB at `packages/server/prisma/e2e.db`; delete it before re-running if it gets sticky.

## Open / deferred

- **Stage 2 (AI card generation)** from the spec is intentionally not built. When it lands it will go in a new `domains/ai/` (server) + `domains/cards/card-generate.page.tsx` (client) per the domain-grouping rule.
- No admin UI for languages — the spec says edit SQLite directly.
- No password reset flow / email verification (better-auth supports it; not wired up).

## Project conventions (must follow)

These are durable preferences for this project — apply them on every change.

### Domain-first source layout

Group source files by **business domain** (`domains/decks/`, `domains/cards/`, `domains/review/`, `domains/auth/`), not by technical layer. Each domain folder holds its router/service/schema (server) or page/sub-components (client). Cross-cutting plumbing (db, auth, trpc init, theme provider, generic UI primitives) lives under `infra/` or `ui/`. Don't introduce top-level `routers/`, `services/`, or `components/` buckets that span domains.

### Prettier

`.prettierrc.json` at the repo root: `printWidth: 100`, `semi: false`, otherwise defaults. Always run `pnpm format` after introducing or moving code; `pnpm format:check` is one of the quality gates. `.prettierignore` covers the Prisma generated client, `routeTree.gen.ts`, migrations, lockfile, and DB files.

### Frontend ESLint — minimal only

`packages/client/eslint.config.js` configures **only** these rules:

- `@typescript-eslint/no-unused-vars` (`argsIgnorePattern: "^_"`)
- `eslint-plugin-react` recommended rules
- `eslint-plugin-react-hooks` (rules-of-hooks + exhaustive-deps)

Do not add `eslint-config-airbnb`, `eslint-plugin-import`, prettier-eslint integration, a11y plugins, stylistic rules, or any other plugin unless explicitly requested. Server and shared packages have no ESLint config — typecheck is the only gate there.

### Plans include QA

When producing implementation plans (especially for new features or scaffolding), always list TypeScript typecheck, ESLint, Vitest integration tests, and Playwright e2e as first-class deliverables and verification steps. Do not omit them as "out of scope" unless the user explicitly says so.
