-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "BookChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startPageIndex" INTEGER NOT NULL,
    CONSTRAINT "BookChapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "chapterId" TEXT,
    "markdown" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "translation" TEXT,
    "translationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "translationError" TEXT,
    CONSTRAINT "BookPage_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookPage_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "BookChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookBookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookBookmark_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookReadingStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "pagesRead" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BookReadingStat_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DECK',
    "userId" TEXT NOT NULL,
    "defaultFrontLanguageId" INTEGER,
    "defaultBackLanguageId" INTEGER,
    "speechRecognitionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inverseReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inverseReviewStreak" INTEGER NOT NULL DEFAULT 0,
    "sequentialEnabled" BOOLEAN NOT NULL DEFAULT false,
    "completionScore" REAL,
    "completionComputedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sortOrder" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deck_defaultFrontLanguageId_fkey" FOREIGN KEY ("defaultFrontLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deck_defaultBackLanguageId_fkey" FOREIGN KEY ("defaultBackLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Deck" ("completionComputedAt", "completionScore", "createdAt", "defaultBackLanguageId", "defaultFrontLanguageId", "id", "inverseReviewEnabled", "inverseReviewStreak", "name", "sequentialEnabled", "sortOrder", "speechRecognitionEnabled", "userId") SELECT "completionComputedAt", "completionScore", "createdAt", "defaultBackLanguageId", "defaultFrontLanguageId", "id", "inverseReviewEnabled", "inverseReviewStreak", "name", "sequentialEnabled", "sortOrder", "speechRecognitionEnabled", "userId" FROM "Deck";
DROP TABLE "Deck";
ALTER TABLE "new_Deck" RENAME TO "Deck";
CREATE UNIQUE INDEX "Deck_userId_name_key" ON "Deck"("userId", "name");
CREATE TABLE "new_WorkerJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT,
    "bookId" TEXT,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkerJob_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ImportProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkerJob_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkerJob" ("attempts", "availableAt", "createdAt", "error", "finishedAt", "id", "processId", "startedAt", "status", "type", "updatedAt") SELECT "attempts", "availableAt", "createdAt", "error", "finishedAt", "id", "processId", "startedAt", "status", "type", "updatedAt" FROM "WorkerJob";
DROP TABLE "WorkerJob";
ALTER TABLE "new_WorkerJob" RENAME TO "WorkerJob";
CREATE INDEX "WorkerJob_status_availableAt_createdAt_idx" ON "WorkerJob"("status", "availableAt", "createdAt");
CREATE INDEX "WorkerJob_processId_idx" ON "WorkerJob"("processId");
CREATE INDEX "WorkerJob_bookId_type_status_idx" ON "WorkerJob"("bookId", "type", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Book_deckId_key" ON "Book"("deckId");

-- CreateIndex
CREATE INDEX "Book_userId_createdAt_idx" ON "Book"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BookChapter_bookId_startPageIndex_idx" ON "BookChapter"("bookId", "startPageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "BookChapter_bookId_order_key" ON "BookChapter"("bookId", "order");

-- CreateIndex
CREATE INDEX "BookPage_bookId_translationStatus_idx" ON "BookPage"("bookId", "translationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BookPage_bookId_index_key" ON "BookPage"("bookId", "index");

-- CreateIndex
CREATE INDEX "BookBookmark_bookId_pageIndex_idx" ON "BookBookmark"("bookId", "pageIndex");

-- CreateIndex
CREATE INDEX "BookReadingStat_bookId_date_idx" ON "BookReadingStat"("bookId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BookReadingStat_bookId_date_key" ON "BookReadingStat"("bookId", "date");
