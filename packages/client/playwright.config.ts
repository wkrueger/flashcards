import { defineConfig, devices } from "@playwright/test"
import { closeSync, existsSync, openSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_DB = path.resolve(__dirname, "../server/prisma/e2e.db")
const serverPort = process.env.E2E_SERVER_PORT ?? "3001"
const clientPort = process.env.E2E_CLIENT_PORT ?? "5173"
const serverOrigin = `http://localhost:${serverPort}`
const clientOrigin = `http://localhost:${clientPort}`

if (!existsSync(E2E_DB)) closeSync(openSync(E2E_DB, "w"))

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: clientOrigin,
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts && pnpm exec tsx src/main.ts`,
      cwd: path.resolve(__dirname, "../server"),
      url: `${serverOrigin}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: `file:${E2E_DB}`,
        BETTER_AUTH_SECRET: "e2e-secret-32-chars-aaaaaaaaaaaaaaaaa",
        BETTER_AUTH_URL: serverOrigin,
        SERVER_PORT: serverPort,
        CLIENT_ORIGIN: clientOrigin,
        AUTH_E2E_AUTOVERIFY: "1",
      },
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${clientPort}`,
      cwd: __dirname,
      url: clientOrigin,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        E2E_SERVER_PORT: serverPort,
      },
    },
  ],
})
