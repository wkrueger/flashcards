-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleLocked" BOOLEAN NOT NULL DEFAULT false,
    "author" TEXT,
    "epubLanguage" TEXT,
    "sourceLanguageId" INTEGER,
    "targetLanguageId" INTEGER,
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "currentPageIndex" INTEGER NOT NULL DEFAULT 0,
    "furthestPageIndex" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" DATETIME,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Book_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Book_sourceLanguageId_fkey" FOREIGN KEY ("sourceLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Book_targetLanguageId_fkey" FOREIGN KEY ("targetLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Book" ("author", "createdAt", "currentPageIndex", "deckId", "epubLanguage", "errorSummary", "fileSize", "filename", "furthestPageIndex", "id", "lastReadAt", "pageCount", "sourceLanguageId", "status", "storagePath", "targetLanguageId", "title", "updatedAt", "userId") SELECT "author", "createdAt", "currentPageIndex", "deckId", "epubLanguage", "errorSummary", "fileSize", "filename", "furthestPageIndex", "id", "lastReadAt", "pageCount", "sourceLanguageId", "status", "storagePath", "targetLanguageId", "title", "updatedAt", "userId" FROM "Book";
DROP TABLE "Book";
ALTER TABLE "new_Book" RENAME TO "Book";
CREATE UNIQUE INDEX "Book_deckId_key" ON "Book"("deckId");
CREATE INDEX "Book_userId_createdAt_idx" ON "Book"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
