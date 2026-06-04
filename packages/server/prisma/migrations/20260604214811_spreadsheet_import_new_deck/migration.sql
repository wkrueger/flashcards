-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpreadsheetImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deckId" TEXT,
    "ignoreRowIds" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "workerJobId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCardCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCardCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCardCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "errorDetailsJson" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpreadsheetImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpreadsheetImport_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SpreadsheetImport" ("completedAt", "createdAt", "createdCardCount", "deckId", "deletedCardCount", "errorDetailsJson", "errorSummary", "fileSize", "filename", "id", "rowCount", "status", "storagePath", "updatedAt", "updatedCardCount", "userId", "workerJobId") SELECT "completedAt", "createdAt", "createdCardCount", "deckId", "deletedCardCount", "errorDetailsJson", "errorSummary", "fileSize", "filename", "id", "rowCount", "status", "storagePath", "updatedAt", "updatedCardCount", "userId", "workerJobId" FROM "SpreadsheetImport";
DROP TABLE "SpreadsheetImport";
ALTER TABLE "new_SpreadsheetImport" RENAME TO "SpreadsheetImport";
CREATE INDEX "SpreadsheetImport_userId_createdAt_idx" ON "SpreadsheetImport"("userId", "createdAt");
CREATE INDEX "SpreadsheetImport_deckId_createdAt_idx" ON "SpreadsheetImport"("deckId", "createdAt");
CREATE INDEX "SpreadsheetImport_status_createdAt_idx" ON "SpreadsheetImport"("status", "createdAt");
CREATE INDEX "SpreadsheetImport_workerJobId_idx" ON "SpreadsheetImport"("workerJobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
