# Cards

Mobile-first vocabulary flashcards with spaced-repetition cooldowns. Multi-user, email + password auth.

## Stack

- **Monorepo**: pnpm workspaces (`packages/shared`, `packages/server`, `packages/client`).
- **Backend**: Fastify + tRPC + Prisma + SQLite. Auth via [better-auth](https://better-auth.com).
- **Frontend**: Vite + React + TanStack Router + TanStack Query + tRPC + shadcn/ui + Tailwind.
- **Tests**: Vitest (server integration) + Playwright (e2e).
- **Tooling**: TypeScript strict, ESLint (frontend, minimal), Prettier (whole repo).

## Layout

```
packages/
├── shared/   # zod schemas, fixation cooldowns
├── server/   # Fastify + tRPC + Prisma; per-domain routers
└── client/   # Vite SPA; per-domain pages and components
```

Source under `src/` is grouped by **domain** (decks, cards, subjects, review, auth) rather than by layer (routers, services, components).

## Setup

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
pnpm --filter server prisma:migrate           # creates SQLite DB and applies migrations
pnpm --filter server prisma:seed              # seeds languages (English, Deutsch)
```

Server runtime and Prisma CLI read environment variables from `packages/server/.env`.

Languages have no UI — add new ones by editing the SQLite `Language` table directly.

### User creation

Set this in `packages/server/.env` to disable new signups while keeping existing user login
available:

```env
DISABLE_USER_CREATION=true
```

Accepted enabled values are `true`, `1`, and `yes`. Leave it unset or set it to `false` in local
development when you want the signup page to create users.

### OpenAI setup

The "Generate card from template" flow calls the OpenAI API from the server. Add these to
`packages/server/.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
```

`OPENAI_MODEL` is optional; the server defaults to `gpt-5-mini` when it is not set.
Restart `pnpm dev` after changing `.env`.

## Develop

```bash
pnpm dev          # runs server (:3001) + client (:5173) concurrently
```

The Vite dev server proxies `/trpc` and `/api/auth` to the Fastify server.

## Quality gates

```bash
pnpm typecheck    # tsc across all packages
pnpm lint         # ESLint (client only — unused-vars + react/react-hooks)
pnpm test         # Vitest server integration tests
pnpm test:e2e     # Playwright happy path (signup → review → free review → edit → logout)
pnpm format       # Prettier write
pnpm format:check # Prettier check
```

## Domain notes

### Cooldowns by fixation level

Stored as a string on `Subject.fixationLevel` to allow future levels without a column-type migration.

| Level | Cooldown |
| ----- | -------- |
| 1     | 2 min    |
| 2     | 10 min   |
| 3     | 12 h     |
| 4     | 2 days   |
| 5     | 1 week   |

### Pickup algorithm

1. Take the user's subjects whose `cooldownAt <= now()` (normal mode) or all subjects (free mode).
2. Slice the oldest 30 % by `cooldownAt` (`ceil(count * 0.3)`, min 1).
3. Random subject from that slice.
4. Within the subject, the card with the oldest `lastSeenAt` (nulls first).

### Review modes

- **Normal**: only cards whose subject is past its cooldown. Empty state offers a "Free review" entry point.
- **Free**: ignores cooldowns; surfaces a card even when nothing is technically due. Stats and cooldowns still update on completion.

### Cooldown buttons

After revealing the back, the user sees four buttons. If the previous fixation was 4 or 5, they get `2..5`; otherwise `1..4`.

### Card template generation

The new-card screen includes "Generate card from template". The current template creates 1-5 phrase cards for a word or expression using the selected front/back languages. Preview generation uses OpenAI; saving confirmed previews uses the normal card creation API.
