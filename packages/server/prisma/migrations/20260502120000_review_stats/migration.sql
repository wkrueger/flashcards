-- CreateTable
CREATE TABLE "ReviewStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "cardMinutes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ReviewStat_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReviewStat_deckId_date_idx" ON "ReviewStat"("deckId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewStat_deckId_date_key" ON "ReviewStat"("deckId", "date");
