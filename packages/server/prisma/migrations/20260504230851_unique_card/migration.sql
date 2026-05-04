-- CreateTable
CREATE TABLE "ReviewStatUniqueCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "reviewStatId" TEXT,
    CONSTRAINT "ReviewStatUniqueCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewStatUniqueCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewStatUniqueCard_reviewStatId_fkey" FOREIGN KEY ("reviewStatId") REFERENCES "ReviewStat" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportCardType" (
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
    "cardMappingsJson" TEXT,
    "pluginsJson" TEXT,
    "previewCardsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportCardType_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ImportProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportCardType" ("cardMappingsJson", "createdAt", "fieldNamesJson", "id", "modelKey", "modelKind", "modelName", "pluginsJson", "previewCardsJson", "processId", "rowCount", "sampleRowsJson", "selected", "subjectField", "updatedAt") SELECT "cardMappingsJson", "createdAt", "fieldNamesJson", "id", "modelKey", "modelKind", "modelName", "pluginsJson", "previewCardsJson", "processId", "rowCount", "sampleRowsJson", "selected", "subjectField", "updatedAt" FROM "ImportCardType";
DROP TABLE "ImportCardType";
ALTER TABLE "new_ImportCardType" RENAME TO "ImportCardType";
CREATE INDEX "ImportCardType_processId_idx" ON "ImportCardType"("processId");
CREATE UNIQUE INDEX "ImportCardType_processId_modelKey_key" ON "ImportCardType"("processId", "modelKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ReviewStatUniqueCard_deckId_cardId_idx" ON "ReviewStatUniqueCard"("deckId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewStatUniqueCard_deckId_cardId_key" ON "ReviewStatUniqueCard"("deckId", "cardId");
