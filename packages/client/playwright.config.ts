import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_DB = path.resolve(__dirname, "../server/prisma/e2e.db")

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm exec prisma migrate deploy && pnpm dev`,
      cwd: path.resolve(__dirname, "../server"),
      url: "http://localhost:3001/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: `file:${E2E_DB}`,
        BETTER_AUTH_SECRET: "e2e-secret-32-chars-aaaaaaaaaaaaaaaaa",
        BETTER_AUTH_URL: "http://localhost:3001",
        SERVER_PORT: "3001",
        CLIENT_ORIGIN: "http://localhost:5173",
        AUTH_E2E_AUTOVERIFY: "1",
      },
    },
    {
      command: "pnpm dev",
      cwd: __dirname,
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
