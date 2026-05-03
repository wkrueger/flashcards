-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportCardType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelKind" TEXT NOT NULL DEFAULT 'BASIC',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fieldNamesJson" TEXT NOT NULL,
    "sampleRowsJson" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "cardMappingsJson" TEXT,
    "previewCardsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportCardType_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ImportProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportCardType" ("id", "processId", "modelKey", "modelName", "modelKind", "rowCount", "fieldNamesJson", "sampleRowsJson", "selected", "previewCardsJson", "createdAt", "updatedAt")
SELECT "id", "processId", "modelKey", "modelName", "modelKind", "rowCount", "fieldNamesJson", "sampleRowsJson", "selected", "previewCardsJson", "createdAt", "updatedAt"
FROM "ImportCardType";
DROP TABLE "ImportCardType";
ALTER TABLE "new_ImportCardType" RENAME TO "ImportCardType";
CREATE UNIQUE INDEX "ImportCardType_processId_modelKey_key" ON "ImportCardType"("processId", "modelKey");
CREATE INDEX "ImportCardType_processId_idx" ON "ImportCardType"("processId");
PRAGMA foreign_keys=ON;
