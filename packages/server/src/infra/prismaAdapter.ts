import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"

export function createPrismaAdapter() {
  const url = process.env.DATABASE_URL

  if (!url) {
    throw new Error("DATABASE_URL is required to initialize Prisma")
  }

  const normalizedUrl = url === "file:./dev.db" ? "file:./prisma/dev.db" : url

  return new PrismaBetterSqlite3({ url: normalizedUrl }, { timestampFormat: "unixepoch-ms" })
}
