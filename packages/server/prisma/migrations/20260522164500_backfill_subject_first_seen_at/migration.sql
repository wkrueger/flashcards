-- Backfill existing subjects from the only durable seen timestamp available.
UPDATE "Subject"
SET "firstSeenAt" = "lastSeenAt"
WHERE "firstSeenAt" IS NULL
  AND "lastSeenAt" IS NOT NULL;
