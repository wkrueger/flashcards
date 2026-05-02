# Cards

Mobile-first vocabulary flashcards with spaced-repetition cooldowns. Multi-user, email + password auth.

> PS: this is built with A1 with very low code reviewing.

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

> While the app was built for multi user from start to avoid future refactors, the multi-user feature is latent and insecure. For now I'm adding a feature to disable user creation for personal safe use.

Set this in `packages/server/.env` to disable new signups while keeping existing user login
available:

```env
DISABLE_USER_CREATION=true
```

Accepted enabled values are `true`, `1`, and `yes`. Leave it unset or set it to `false` in local
development when you want the signup page to create users.

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

---

## Domain notes

### Cooldowns by fixation level

Stored as a string on `Subject.fixationLevel` to allow future levels without a column-type migration.

-- not up to date --

### Pickup algorithm

-- not up to date --

### Review modes

- **Normal**: only cards whose subject is past its cooldown. Empty state offers a "Free review" entry point.
- **Free**: ignores cooldowns; surfaces a card even when nothing is technically due. Stats and cooldowns still update on completion.

### Cooldown buttons

After revealing the back, the user sees four buttons. If the previous fixation was 4 or 5, they get `2..5`; otherwise `1..4`.

### Card template generation

The new-card screen includes "Generate card from template". The current template creates 1-5 phrase cards for a word or expression using the selected front/back languages. Preview generation uses OpenAI; saving confirmed previews uses the normal card creation API.

## Anki phrase extraction

Use the root CLI to extract only text phrase pairs from an Anki `.apkg` into a JSON array of
`{ front, back, base_e, base_d, full_d, artikel_d, plural_d }` objects. The extractor reads
`collection.anki2`, maps note fields from the note model, pulls sentence pairs from `s1..s9` /
`s1e..s9e`, carries through the German base metadata fields plus the base translation, and ignores
media payloads such as audio references and images. The implementation lives in
`packages/server/scripts/`.

```bash
pnpm extract:anki-phrases \
  --input ~/Downloads/B1_Wortliste_DTZ_Goethe_vocabsentensesaudiotranslation.apkg \
  --output ./tmp/b1-phrases.json
```
