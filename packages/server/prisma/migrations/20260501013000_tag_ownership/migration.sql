-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Tag" ("id", "ownerType", "ownerKey", "userId", "name")
SELECT
    lower(hex(randomblob(16))),
    'SYSTEM',
    'system',
    NULL,
    "name"
FROM "Tag"
WHERE "name" IN ('gen:bigger', 'gen:meaning')
GROUP BY "name";

INSERT INTO "new_Tag" ("id", "ownerType", "ownerKey", "userId", "name")
SELECT
    "id",
    'USER',
    "userId",
    "userId",
    "name"
FROM "Tag"
WHERE "name" NOT IN ('gen:bigger', 'gen:meaning');

CREATE TABLE "new_CardTag" (
    "cardId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("cardId", "tagId"),
    CONSTRAINT "CardTag_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "new_Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "new_CardTag" ("cardId", "tagId")
SELECT
    "CardTag"."cardId",
    "new_Tag"."id"
FROM "CardTag"
JOIN "Tag" ON "Tag"."id" = "CardTag"."tagId"
JOIN "new_Tag" ON "new_Tag"."name" = "Tag"."name"
    AND "new_Tag"."ownerKey" = CASE
        WHEN "Tag"."name" IN ('gen:bigger', 'gen:meaning') THEN 'system'
        ELSE "Tag"."userId"
    END;

DROP TABLE "CardTag";
DROP TABLE "Tag";
ALTER TABLE "new_Tag" RENAME TO "Tag";
ALTER TABLE "new_CardTag" RENAME TO "CardTag";

CREATE INDEX "Tag_ownerKey_idx" ON "Tag"("ownerKey");
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");
CREATE UNIQUE INDEX "Tag_ownerKey_name_key" ON "Tag"("ownerKey", "name");
CREATE INDEX "CardTag_tagId_idx" ON "CardTag"("tagId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
