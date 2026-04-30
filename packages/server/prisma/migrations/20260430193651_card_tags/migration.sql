-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardTag" (
    "cardId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("cardId", "tagId"),
    CONSTRAINT "CardTag_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "randomKey" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "lastSeenAt" DATETIME,
    "timesSeen" INTEGER NOT NULL DEFAULT 0,
    "fixationLevel" TEXT NOT NULL DEFAULT '1',
    "cooldownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Subject" ("cooldownAt", "fixationLevel", "id", "lastSeenAt", "randomKey", "subject", "subjectKey", "timesSeen", "userId") SELECT "cooldownAt", "fixationLevel", "id", "lastSeenAt", "randomKey", "subject", "subjectKey", "timesSeen", "userId" FROM "Subject";
DROP TABLE "Subject";
ALTER TABLE "new_Subject" RENAME TO "Subject";
CREATE INDEX "Subject_userId_randomKey_idx" ON "Subject"("userId", "randomKey");
CREATE INDEX "Subject_userId_cooldownAt_randomKey_idx" ON "Subject"("userId", "cooldownAt", "randomKey");
CREATE UNIQUE INDEX "Subject_userId_subjectKey_key" ON "Subject"("userId", "subjectKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "Tag"("userId", "name");

-- CreateIndex
CREATE INDEX "CardTag_tagId_idx" ON "CardTag"("tagId");
