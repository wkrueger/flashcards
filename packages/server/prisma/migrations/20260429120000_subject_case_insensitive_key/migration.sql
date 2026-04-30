-- Add a normalized subject key so uniqueness is case-insensitive while preserving display text.
ALTER TABLE "Subject" ADD COLUMN "subjectKey" TEXT NOT NULL DEFAULT '';

UPDATE "Subject"
SET
    "subject" = trim("subject"),
    "subjectKey" = lower(trim("subject"));

CREATE TABLE "SubjectDeduplicate" AS
SELECT
    duplicate."id" AS "duplicateId",
    keeper."id" AS "keeperId"
FROM "Subject" duplicate
JOIN (
    SELECT
        "userId",
        "subjectKey",
        min("id") AS "id"
    FROM "Subject"
    GROUP BY "userId", "subjectKey"
) keeper
    ON keeper."userId" = duplicate."userId"
    AND keeper."subjectKey" = duplicate."subjectKey"
    AND keeper."id" != duplicate."id";

DELETE FROM "Card"
WHERE EXISTS (
    SELECT 1
    FROM "SubjectDeduplicate" dedupe
    JOIN "Card" keeperCard
        ON keeperCard."subjectId" = dedupe."keeperId"
        AND keeperCard."frontHash" = "Card"."frontHash"
    WHERE dedupe."duplicateId" = "Card"."subjectId"
);

UPDATE "Card"
SET "subjectId" = (
    SELECT "keeperId"
    FROM "SubjectDeduplicate"
    WHERE "duplicateId" = "Card"."subjectId"
)
WHERE "subjectId" IN (SELECT "duplicateId" FROM "SubjectDeduplicate");

DELETE FROM "Subject"
WHERE "id" IN (SELECT "duplicateId" FROM "SubjectDeduplicate");

DROP TABLE "SubjectDeduplicate";

DROP INDEX "Subject_userId_subject_key";

CREATE UNIQUE INDEX "Subject_userId_subjectKey_key" ON "Subject"("userId", "subjectKey");
