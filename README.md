# Cards

Mobile-first vocabulary flashcards with spaced-repetition cooldowns. Multi-user.  
I have initially built this mostly for personal use.

### Current features:

- Simple flashcards; Phrases with highlighted words;
- Occasionally displays cards in inverse order;
- Call an AI API (currently OpenAI) to generate phrases for cards;
- Imports some patterns of Anki files;
- Includes a speech recognition box so that the user is encouraged to read phrases out loud. Correction is out of scope of the project. Heavily subject to browser compatibility (works on Safari);
- Pleasant UI. Colorful daily stats.

### Choices and details:

UI:
 - The UI has constrained width on purpose, so that I avoid tinkering with more breakpoints;

Flashcards:
 - Uses a simplified voting system. Just select the next time you want to see the card. This is a bit different from usual spaced repetition since no calculation is made based on how many times you've seen the card;
 - Current choices as of this writing: 5s, 10m, 12h, 2d, 5d, 12d;
 - Only 4 choices appear at a time. If you had checked 2d, the next time you review the card you will be given the 5d choice, and so on;
 - Cards are grouped by "words" (subjects, in app terminology), so that we can have a variety of phrases;

Current algorithm (subject to change):
 - ~90% of the time, pick between most recently seen cards
 - ~10% of the time, pick a random card from the whole deck

This means that, when you have a big deck, you will mostly keep circling on the new words until you get comfortable with them, and then slowly progress.

Inverse review:
 - Inverse review is seen as an "easy mode" review. An inverse review updates the "last seen" field but does not add a cooldown;
 - You don't have the option to add a cooldown on inverse reviews;
 - When you inverse review a card, the same card will be soon displayed on normal mode, since the "last seen" timer is updated;
 - When you are struggling on a card, the inverse review chance is increased;


---

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


### Email (Mailgun)

Verification and password-reset emails go through Mailgun. In dev you can leave the variables
blank — the server will log the email body (with the link) to stdout instead of sending.

```env
MAILGUN_API_KEY=key-...
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_FROM="Cards <no-reply@mg.yourdomain.com>"
MAILGUN_REGION=us            # or "eu"
```

### Google SSO

Optional. Create OAuth credentials at <https://console.cloud.google.com/apis/credentials>; the
authorized redirect URI is `${BETTER_AUTH_URL}/api/auth/callback/google`.

Server (`packages/server/.env`):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Client (`packages/client/.env`, optional — defaults to disabled):

```env
VITE_GOOGLE_SSO_ENABLED=true
```

### OpenAI setup

The "Generate card from template" flow calls the OpenAI API from the server. Add these to
`packages/server/.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```

`OPENAI_MODEL` is optional; the server defaults to `gpt-5.4-mini` when it is not set.
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

## Deploy

### Environment

Create `packages/server/.env` on the server:

```env
NODE_ENV=production
DATABASE_URL="file:/absolute/path/to/cards/packages/server/prisma/prod.db"
BETTER_AUTH_SECRET="<random 32+ char string — required, server won't start without it>"
BETTER_AUTH_URL="https://yourdomain.com"
SERVER_PORT=3001
CLIENT_ORIGIN="https://yourdomain.com"
OPENAI_API_KEY="sk-..."
DISABLE_USER_CREATION=true   # optional: lock signups after initial setup
```

### Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` runs in order: `prisma migrate deploy` → `prisma generate` → server `tsc` → client Vite build.

Output:

- `packages/server/dist/main.js` — compiled Fastify server (run with Node)
- `packages/client/dist/` — static SPA (serve behind any HTTP server or CDN)

### Run

```bash
node packages/server/dist/main.js
```

Ensure environment variables are set before starting (e.g. via your process manager or host
platform). The frontend is static — serve `packages/client/dist/` from any static host and
proxy `/trpc` and `/api` to the Fastify process.

### First-time user setup

Visit `/signup` to create your account, then set `DISABLE_USER_CREATION=true` in `.env`
and restart the server to prevent further signups.

### Subsequent deployments

```bash
git pull
pnpm install --frozen-lockfile
pnpm build
# restart the server process
```

```
