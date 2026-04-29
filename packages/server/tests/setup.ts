import { execSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs"
import path from "node:path"
import { afterAll, beforeAll } from "vitest"

const TMP_DIR = path.resolve(process.cwd(), ".test-db")
const DB_FILE = path.join(TMP_DIR, `test-${process.pid}.db`)

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })
process.env.DATABASE_URL = `file:${DB_FILE}`
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "test-secret-32-chars-aaaaaaaaaaaaaa"

beforeAll(() => {
  // Clean prior file (between vitest re-runs).
  for (const ext of ["", "-journal"]) {
    const f = `${DB_FILE}${ext}`
    if (existsSync(f)) rmSync(f)
  }
  closeSync(openSync(DB_FILE, "w"))
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${DB_FILE}` },
  })
})

afterAll(async () => {
  const { prisma } = await import("../src/infra/db.js")
  await prisma.$disconnect()
  for (const ext of ["", "-journal"]) {
    const f = `${DB_FILE}${ext}`
    if (existsSync(f)) rmSync(f)
  }
})
