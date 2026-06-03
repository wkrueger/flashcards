-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "randomKey" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "firstSeenAt" DATETIME,
    "lastSeenAt" DATETIME,
    "lastSeenShuffle" DATETIME,
    "timesSeen" INTEGER NOT NULL DEFAULT 0,
    "fixationLevel" TEXT NOT NULL DEFAULT '1',
    "order" INTEGER,
    "inverseReviewed" BOOLEAN NOT NULL DEFAULT false,
    "cooldownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subject_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Subject" ("cooldownAt", "deckId", "firstSeenAt", "fixationLevel", "id", "inverseReviewed", "lastSeenAt", "lastSeenShuffle", "order", "randomKey", "subject", "subjectKey", "timesSeen", "userId") SELECT "cooldownAt", "deckId", "firstSeenAt", "fixationLevel", "id", "inverseReviewed", "lastSeenAt", "lastSeenShuffle", "order", "randomKey", "subject", "subjectKey", "timesSeen", "userId" FROM "Subject";
DROP TABLE "Subject";
ALTER TABLE "new_Subject" RENAME TO "Subject";
CREATE INDEX "Subject_deckId_randomKey_idx" ON "Subject"("deckId", "randomKey");
CREATE INDEX "Subject_deckId_cooldownAt_randomKey_idx" ON "Subject"("deckId", "cooldownAt", "randomKey");
CREATE INDEX "Subject_deckId_lastSeenShuffle_idx" ON "Subject"("deckId", "lastSeenShuffle");
CREATE INDEX "Subject_userId_lastSeenShuffle_idx" ON "Subject"("userId", "lastSeenShuffle");
CREATE INDEX "Subject_userId_deckId_idx" ON "Subject"("userId", "deckId");
CREATE UNIQUE INDEX "Subject_deckId_subjectKey_key" ON "Subject"("deckId", "subjectKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
