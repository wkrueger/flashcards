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
    "inverseReviewed" BOOLEAN NOT NULL DEFAULT false,
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
