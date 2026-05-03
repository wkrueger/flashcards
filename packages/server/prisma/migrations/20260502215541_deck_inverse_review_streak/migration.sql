-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultFrontLanguageId" INTEGER,
    "defaultBackLanguageId" INTEGER,
    "inverseReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inverseReviewStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deck_defaultFrontLanguageId_fkey" FOREIGN KEY ("defaultFrontLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deck_defaultBackLanguageId_fkey" FOREIGN KEY ("defaultBackLanguageId") REFERENCES "Language" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Deck" ("createdAt", "defaultBackLanguageId", "defaultFrontLanguageId", "id", "inverseReviewEnabled", "name", "userId") SELECT "createdAt", "defaultBackLanguageId", "defaultFrontLanguageId", "id", "inverseReviewEnabled", "name", "userId" FROM "Deck";
DROP TABLE "Deck";
ALTER TABLE "new_Deck" RENAME TO "Deck";
CREATE UNIQUE INDEX "Deck_userId_name_key" ON "Deck"("userId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
