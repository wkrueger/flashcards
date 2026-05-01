PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "SubjectDeckMap" AS
SELECT
  CASE
    WHEN ROW_NUMBER() OVER (PARTITION BY "s"."id" ORDER BY "c"."deckId") = 1 THEN "s"."id"
    ELSE lower(hex(randomblob(16)))
  END AS "newSubjectId",
  "s"."id" AS "oldSubjectId",
  "c"."deckId" AS "deckId",
  "s"."userId" AS "userId",
  "s"."subject" AS "subject",
  "s"."subjectKey" AS "subjectKey",
  "s"."randomKey" AS "randomKey",
  "s"."lastSeenAt" AS "lastSeenAt",
  "s"."timesSeen" AS "timesSeen",
  "s"."fixationLevel" AS "fixationLevel",
  "s"."inverseReviewed" AS "inverseReviewed",
  "s"."cooldownAt" AS "cooldownAt"
FROM "Subject" "s"
JOIN (
  SELECT DISTINCT "subjectId", "deckId"
  FROM "Card"
) "c" ON "c"."subjectId" = "s"."id";

CREATE TABLE "new_Subject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deckId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "randomKey" INTEGER NOT NULL DEFAULT 0,
  "userId" TEXT NOT NULL,
  "lastSeenAt" DATETIME,
  "timesSeen" INTEGER NOT NULL DEFAULT 0,
  "fixationLevel" TEXT NOT NULL DEFAULT '1',
  "inverseReviewed" BOOLEAN NOT NULL DEFAULT false,
  "cooldownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subject_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Subject" (
  "id",
  "deckId",
  "subject",
  "subjectKey",
  "randomKey",
  "userId",
  "lastSeenAt",
  "timesSeen",
  "fixationLevel",
  "inverseReviewed",
  "cooldownAt"
)
SELECT
  "newSubjectId",
  "deckId",
  "subject",
  "subjectKey",
  "randomKey",
  "userId",
  "lastSeenAt",
  "timesSeen",
  "fixationLevel",
  "inverseReviewed",
  "cooldownAt"
FROM "SubjectDeckMap";

CREATE TABLE "new_Card" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deckId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "front" TEXT NOT NULL,
  "frontHash" TEXT NOT NULL,
  "back" TEXT NOT NULL,
  "genTemplate" TEXT,
  "lastSeenAt" DATETIME,
  "timesSeen" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Card_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Card" (
  "id",
  "deckId",
  "subjectId",
  "front",
  "frontHash",
  "back",
  "genTemplate",
  "lastSeenAt",
  "timesSeen",
  "createdAt"
)
SELECT
  "c"."id",
  "c"."deckId",
  "m"."newSubjectId",
  "c"."front",
  "c"."frontHash",
  "c"."back",
  "c"."genTemplate",
  "c"."lastSeenAt",
  "c"."timesSeen",
  "c"."createdAt"
FROM "Card" "c"
JOIN "SubjectDeckMap" "m"
  ON "m"."oldSubjectId" = "c"."subjectId"
 AND "m"."deckId" = "c"."deckId";

DROP TABLE "Card";
DROP TABLE "Subject";
ALTER TABLE "new_Subject" RENAME TO "Subject";
ALTER TABLE "new_Card" RENAME TO "Card";
DROP TABLE "SubjectDeckMap";

CREATE INDEX "Subject_deckId_randomKey_idx" ON "Subject"("deckId", "randomKey");
CREATE INDEX "Subject_deckId_cooldownAt_randomKey_idx" ON "Subject"("deckId", "cooldownAt", "randomKey");
CREATE INDEX "Subject_userId_deckId_idx" ON "Subject"("userId", "deckId");
CREATE UNIQUE INDEX "Subject_deckId_subjectKey_key" ON "Subject"("deckId", "subjectKey");
CREATE UNIQUE INDEX "Card_subjectId_frontHash_key" ON "Card"("subjectId", "frontHash");
CREATE INDEX "Card_subjectId_lastSeenAt_idx" ON "Card"("subjectId", "lastSeenAt");
CREATE INDEX "Card_deckId_idx" ON "Card"("deckId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
