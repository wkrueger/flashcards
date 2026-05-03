CREATE TABLE "ImportProcess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "detectedCollectionFile" TEXT,
    "deckName" TEXT,
    "defaultFrontLanguageId" INTEGER,
    "defaultBackLanguageId" INTEGER,
    "inverseReviewEnabled" BOOLEAN,
    "createdDeckId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "selectedRowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCardCount" INTEGER NOT NULL DEFAULT 0,
    "failedRowCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "errorDetailsJson" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportProcess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportProcess_defaultFrontLanguageId_fkey" FOREIGN KEY ("defaultFrontLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportProcess_defaultBackLanguageId_fkey" FOREIGN KEY ("defaultBackLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ImportCardType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelKind" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "fieldNamesJson" TEXT NOT NULL,
    "sampleRowsJson" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "subjectField" TEXT,
    "frontField" TEXT,
    "backField" TEXT,
    "previewCardsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportCardType_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ImportProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WorkerJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkerJob_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ImportProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ImportProcess_userId_createdAt_idx" ON "ImportProcess"("userId", "createdAt");
CREATE INDEX "ImportProcess_status_createdAt_idx" ON "ImportProcess"("status", "createdAt");
CREATE UNIQUE INDEX "ImportCardType_processId_modelKey_key" ON "ImportCardType"("processId", "modelKey");
CREATE INDEX "ImportCardType_processId_idx" ON "ImportCardType"("processId");
CREATE INDEX "WorkerJob_status_availableAt_createdAt_idx" ON "WorkerJob"("status", "availableAt", "createdAt");
CREATE INDEX "WorkerJob_processId_idx" ON "WorkerJob"("processId");
